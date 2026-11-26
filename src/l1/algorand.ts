import { base32nopad, hex } from '@scure/base'
import { sha512_256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { concat, fromBase64, notOwn, rest, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'

const genesisHash = 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8='
const genesisId = 'mainnet-v1.0'
const minimumBalance = 100_000n

export function algorandAddress(publicKey: Uint8Array) {
  return base32nopad.encode(concat(publicKey, sha512_256(publicKey).subarray(28)))
}

function decode(address: string) {
  try {
    const bytes = base32nopad.decode(address.trim())
    const key = bytes.subarray(0, 32)
    if (bytes.length === 36 && algorandAddress(key) === address.trim()) return key
  } catch { /* Fall through. */ }
  throw new Error('Enter a valid Algorand address.')
}

/** Canonical msgpack for the few types a payment uses. */
type Pack = number | bigint | string | Uint8Array | { [key: string]: Pack }
function pack(value: Pack): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length < 256) return concat([0xc4, value.length], value)
    return concat([0xc5, value.length >> 8, value.length & 0xff], value)
  }
  if (typeof value === 'string') {
    const bytes = utf8(value)
    return bytes.length < 32 ? concat([0xa0 | bytes.length], bytes) : concat([0xd9, bytes.length], bytes)
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    const number = BigInt(value)
    if (number < 128n) return Uint8Array.of(Number(number))
    const sizes = [[0xcc, 1], [0xcd, 2], [0xce, 4], [0xcf, 8]] as const
    const [tag, size] = sizes.find(([, bytes]) => number < 1n << BigInt(bytes * 8))!
    return concat([tag], hex.decode(number.toString(16).padStart(size * 2, '0')))
  }
  const keys = Object.keys(value).sort()
  if (keys.length > 15) throw new Error('Unsupported transaction.')
  return concat([0x80 | keys.length], ...keys.flatMap((key) => [pack(key), pack(value[key])]))
}

export function algorandPayment(fields: { from: Uint8Array; to: Uint8Array; amount: bigint; fee: bigint; first: bigint; last: bigint; note: Uint8Array }) {
  const tx: Record<string, Pack> = { fee: fields.fee, fv: fields.first, gen: genesisId, gh: fromBase64(genesisHash), lv: fields.last, rcv: fields.to, snd: fields.from, type: 'pay' }
  if (fields.amount) tx.amt = fields.amount
  if (fields.note.length) tx.note = fields.note
  return tx
}

export function algorandSign(tx: Record<string, Pack>, key: Uint8Array) {
  const message = concat(utf8('TX'), pack(tx))
  const signed = pack({ sig: ed25519.sign(message, key), txn: tx })
  return { id: base32nopad.encode(sha512_256(message)), signed }
}

type Account = { amount?: number | string; 'min-balance'?: number | string }

export async function checkAlgorand(endpoint: string, fetcher: Fetcher) {
  const params = await rest<{ 'genesis-hash'?: string }>(endpoint, '/v2/transactions/params', fetcher)
  if (params?.['genesis-hash'] !== genesisHash) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function algorandBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  const account = await rest<Account>(endpoint, `/v2/accounts/${owner}?exclude=all`, fetcher)
  return BigInt(account?.amount ?? 0)
}

export async function quoteAlgorand(network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  const receiver = decode(recipient)
  const to = recipient.trim()
  notOwn(from, to)
  const value = parseAmount(amount, 6)
  const note = utf8(memo.trim())
  if (note.length > 1000) throw new Error('Keep the note under 1000 bytes.')
  const [account, target, params] = await Promise.all([
    rest<Account>(endpoint, `/v2/accounts/${from}?exclude=all`, fetcher),
    rest<Account>(endpoint, `/v2/accounts/${to}?exclude=all`, fetcher),
    rest<{ fee?: number; 'min-fee'?: number; 'last-round'?: number; 'genesis-hash'?: string }>(endpoint, '/v2/transactions/params', fetcher),
  ])
  if (!params?.['last-round'] || params['genesis-hash'] !== genesisHash) throw new Error('Algorand network fees are currently unavailable.')
  if (BigInt(target?.amount ?? 0) === 0n && value < minimumBalance) throw new Error('This address isn’t active yet. Send at least 0.1 ALGO to activate it.')
  const tx = algorandPayment({ from: decode(from), to: receiver, amount: value, fee: 0n, first: BigInt(params['last-round']), last: BigInt(params['last-round'] + 1000), note })
  const size = BigInt(pack({ sig: new Uint8Array(64), txn: { ...tx, fee: 1_000_000 } }).length)
  const fee = BigInt(Math.max(params['min-fee'] ?? 1000, 1000)) > BigInt(params.fee ?? 0) * size ? BigInt(Math.max(params['min-fee'] ?? 1000, 1000)) : BigInt(params.fee ?? 0) * size
  tx.fee = fee
  const balance = BigInt(account?.amount ?? 0)
  const locked = BigInt(account?.['min-balance'] ?? minimumBalance)
  if (balance - value - fee < locked) throw new Error(`Insufficient ALGO. ${formatAmount(locked, 6)} ALGO stays locked as the minimum balance.`)
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 6), fee: formatAmount(fee, 6), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'algorand')
      try {
        sameWallet(from, algorandAddress(ed25519.getPublicKey(key)))
        const { id, signed } = algorandSign(tx, key)
        return { hash: id, async broadcast() {
          const reply = await rest<{ txId?: string; message?: string }>(endpoint, '/v2/transactions', fetcher, hex.encode(signed), 'text/plain')
          if (reply?.txId !== id) throw new Error(reply?.message ? `Algorand rejected the transaction: ${reply.message}` : 'Algorand submission is unverified.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function algorandStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^[A-Z2-7]{52}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const reply = await rest<{ 'confirmed-round'?: number; 'pool-error'?: string }>(endpoint, `/v2/transactions/pending/${item.hash}`, fetcher)
  if (reply?.['confirmed-round']) return 'confirmed'
  if (reply?.['pool-error']) return 'failed'
  // The node forgets transactions soon after they leave its pool, and a send is only valid for 1000 rounds (about an hour).
  return Date.now() - item.created > 2 * 60 * 60_000 ? 'unknown' : item.status
}
