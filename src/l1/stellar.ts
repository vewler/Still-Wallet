import { base32nopad, hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { base64, concat, notOwn, rest, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'

const passphrase = 'Public Global Stellar Network ; September 2015'
const reserve = 5_000_000n // 0.5 XLM per base reserve
const accountVersion = 6 << 3

function crc16(bytes: Uint8Array) {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

export function stellarAddress(publicKey: Uint8Array) {
  const payload = concat([accountVersion], publicKey)
  const crc = crc16(payload)
  return base32nopad.encode(concat(payload, [crc & 0xff, crc >> 8]))
}

export function stellarDecode(address: string) {
  let bytes: Uint8Array
  try { bytes = base32nopad.decode(address.trim()) } catch { throw new Error('Enter a valid Stellar address (G…).') }
  if (bytes.length !== 35 || bytes[0] !== accountVersion) throw new Error('Enter a valid Stellar address (G…).')
  const crc = crc16(bytes.subarray(0, 33))
  if (bytes[33] !== (crc & 0xff) || bytes[34] !== crc >> 8) throw new Error('Enter a valid Stellar address (G…).')
  return bytes.slice(1, 33)
}

const u32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value); return out }
const i64 = (value: bigint) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigInt64(0, value); return out }
const u64 = (value: bigint) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value); return out }
const opaque = (bytes: Uint8Array) => concat(u32(bytes.length), bytes, new Uint8Array((4 - bytes.length % 4) % 4))

export function stellarMemo(memo: string) {
  const text = memo.trim()
  if (!text) return u32(0)
  if (/^\d{1,20}$/.test(text) && BigInt(text) < 2n ** 64n) return concat(u32(2), u64(BigInt(text)))
  const bytes = utf8(text)
  if (bytes.length > 28) throw new Error('Stellar memos fit up to 28 bytes.')
  return concat(u32(1), opaque(bytes))
}

/** Transaction XDR with one CreateAccount or Payment of native XLM. */
export function stellarTransaction(source: Uint8Array, fee: number, sequence: bigint, maxTime: bigint, memo: Uint8Array, destination: Uint8Array, amount: bigint, create: boolean) {
  const body = create
    ? concat(u32(0), u32(0), destination, i64(amount))
    : concat(u32(1), u32(0), destination, u32(0), i64(amount))
  return concat(u32(0), source, u32(fee), i64(sequence), u32(1), u64(0n), u64(maxTime), memo, u32(1), u32(0), body, u32(0))
}

export function stellarSign(transaction: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array) {
  const hash = sha256(concat(sha256(utf8(passphrase)), u32(2), transaction))
  const signature = ed25519.sign(hash, privateKey)
  const envelope = concat(u32(2), transaction, u32(1), publicKey.subarray(28), opaque(signature))
  return { hash: hex.encode(hash), envelope: base64(envelope) }
}

type Account = { sequence?: string; subentry_count?: number; num_sponsoring?: number; num_sponsored?: number; balances?: { asset_type?: string; balance?: string; selling_liabilities?: string }[] }

function nativeBalance(account: Account) {
  const entry = account.balances?.find((item) => item.asset_type === 'native')
  if (!entry?.balance) return 0n
  const [whole, fraction = ''] = entry.balance.split('.')
  return BigInt(whole + fraction.padEnd(7, '0').slice(0, 7))
}

export async function checkStellar(endpoint: string, fetcher: Fetcher) {
  const root = await rest<{ network_passphrase?: string }>(endpoint, '/', fetcher)
  if (root?.network_passphrase !== passphrase) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function stellarBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  const account = await rest<Account>(endpoint, `/accounts/${owner}`, fetcher)
  return account ? nativeBalance(account) : 0n
}

export async function quoteStellar(network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  const destination = stellarDecode(recipient)
  const to = stellarAddress(destination)
  notOwn(from, to)
  const value = parseAmount(amount, 7)
  const memoBytes = stellarMemo(memo)
  const [account, target, stats] = await Promise.all([
    rest<Account>(endpoint, `/accounts/${from}`, fetcher),
    rest<Account>(endpoint, `/accounts/${to}`, fetcher),
    rest<{ last_ledger_base_fee?: string; fee_charged?: { p70?: string } }>(endpoint, '/fee_stats', fetcher),
  ])
  if (!account?.sequence) throw new Error('Insufficient XLM. A Stellar account needs at least 1 XLM to activate.')
  const create = !target
  if (create && value < 10_000_000n) throw new Error('This address isn’t active yet. Send at least 1 XLM to activate it.')
  const fee = Math.min(Math.max(Number(stats?.last_ledger_base_fee) || 100, Number(stats?.fee_charged?.p70) || 100), 100_000)
  const minimum = BigInt(2 + (account.subentry_count ?? 0) + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0)) * reserve
  const balance = nativeBalance(account)
  if (balance - value - BigInt(fee) < minimum) throw new Error(`Insufficient XLM. Stellar keeps ${formatAmount(minimum, 7)} XLM locked as the account reserve.`)
  const sequence = BigInt(account.sequence) + 1n
  const maxTime = BigInt(Math.floor(Date.now() / 1000) + 180)
  const source = stellarDecode(from)
  const transaction = stellarTransaction(source, fee, sequence, maxTime, memoBytes, destination, value, create)
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 7), fee: formatAmount(BigInt(fee), 7), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'stellar')
      try {
        const publicKey = ed25519.getPublicKey(key)
        sameWallet(from, stellarAddress(publicKey))
        const { hash, envelope } = stellarSign(transaction, publicKey, key)
        return { hash, lastLedgerSequence: Number(maxTime), async broadcast() {
          const reply = await rest<{ hash?: string; tx_status?: string; extras?: { result_codes?: { transaction?: string } } }>(endpoint, '/transactions_async', fetcher, `tx=${encodeURIComponent(envelope)}`, 'application/x-www-form-urlencoded')
          if (!reply || reply.tx_status === 'ERROR' || (reply.hash && reply.hash !== hash)) throw new Error(`Stellar rejected the transaction${reply?.extras?.result_codes?.transaction ? ` (${reply.extras.result_codes.transaction})` : ''}.`)
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function stellarStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^[a-f\d]{64}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const tx = await rest<{ successful?: boolean }>(endpoint, `/transactions/${item.hash}`, fetcher)
  if (tx) return tx.successful ? 'confirmed' : 'failed'
  if (item.lastLedgerSequence && Date.now() / 1000 > item.lastLedgerSequence + 30) return 'expired'
  return item.status
}
