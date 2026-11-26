import { hex } from '@scure/base'
import { sha256, sha512_256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { concat, notOwn, rest, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'

const c32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const mainnetSingleSig = 22

function c32encode(bytes: Uint8Array) {
  let value = BigInt('0x' + (hex.encode(bytes) || '0'))
  let out = ''
  while (value > 0n) { out = c32[Number(value % 32n)] + out; value /= 32n }
  const zeros = bytes.findIndex((byte) => byte !== 0)
  return c32[0].repeat(zeros === -1 ? bytes.length : zeros) + out
}

function c32decode(text: string) {
  const upper = text.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  let value = 0n
  for (const char of upper) {
    const digit = c32.indexOf(char)
    if (digit < 0) throw new Error('Not c32.')
    value = value * 32n + BigInt(digit)
  }
  let body = value ? value.toString(16) : ''
  if (body.length % 2) body = '0' + body
  const zeros = upper.length - upper.replace(/^0+/, '').length
  return concat(new Uint8Array(zeros), hex.decode(body))
}

const checksum = (version: number, hash: Uint8Array) => sha256(sha256(concat([version], hash))).subarray(0, 4)

export function stacksAddress(publicKey: Uint8Array) {
  const hash = ripemd160(sha256(publicKey))
  return 'S' + c32[mainnetSingleSig] + c32encode(concat(hash, checksum(mainnetSingleSig, hash)))
}

/** Standard principals only (SP… single-sig, SM… multisig). */
export function stacksDecode(address: string) {
  const value = address.trim().toUpperCase()
  try {
    const version = c32.indexOf(value[1])
    if (value[0] === 'S' && (version === 22 || version === 20) && !value.includes('.')) {
      const bytes = c32decode(value.slice(2))
      const hash = bytes.subarray(-24, -4)
      // Re-encoding must give the same text, so mistyped addresses with stray high bits are rejected.
      if (bytes.length >= 24 && checksum(version, hash).every((byte, index) => byte === bytes[bytes.length - 4 + index])
        && 'S' + c32[version] + c32encode(concat(hash, checksum(version, hash))) === value) return { version, hash }
    }
  } catch { /* Fall through. */ }
  throw new Error('Enter a valid Stacks address (SP…).')
}

const u64 = (value: bigint) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value); return out }

/** Serialized STX transfer, signature zeroed when not given. */
export function stacksTransfer(fields: { signer: Uint8Array; nonce: bigint; fee: bigint; to: { version: number; hash: Uint8Array }; amount: bigint; memo: string; signature?: Uint8Array }) {
  const memo = utf8(fields.memo)
  if (memo.length > 34) throw new Error('Stacks memos fit up to 34 bytes.')
  return concat(
    [0x00], [0, 0, 0, 1], [0x04, 0x00], fields.signer, u64(fields.nonce), u64(fields.fee), [0x00], fields.signature ?? new Uint8Array(65),
    [0x03], [0x02], [0, 0, 0, 0],
    [0x00], [0x05, fields.to.version], fields.to.hash, u64(fields.amount), memo, new Uint8Array(34 - memo.length),
  )
}

export function stacksSign(fields: Parameters<typeof stacksTransfer>[0], key: Uint8Array) {
  const initial = sha512_256(stacksTransfer({ ...fields, nonce: 0n, fee: 0n, signature: undefined }))
  const presign = sha512_256(concat(initial, [0x04], u64(fields.fee), u64(fields.nonce)))
  const signature = secp256k1.Signature.fromBytes(secp256k1.sign(presign, key, { prehash: false, format: 'recovered' }), 'recovered')
  const signed = stacksTransfer({ ...fields, signature: concat([signature.recovery!], signature.toBytes('compact')) })
  return { signed, txid: hex.encode(sha512_256(signed)) }
}

export async function checkStacks(endpoint: string, fetcher: Fetcher) {
  const info = await rest<{ network_id?: number }>(endpoint, '/v2/info', fetcher)
  if (info?.network_id !== 1) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function stacksBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  const reply = await rest<{ balance?: string }>(endpoint, `/extended/v1/address/${owner}/stx`, fetcher)
  if (reply?.balance === undefined) throw new Error('The Stacks API could not load the balance.')
  return BigInt(reply.balance)
}

export async function quoteStacks(network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  const target = stacksDecode(recipient)
  const to = recipient.trim().toUpperCase()
  notOwn(from, to)
  const value = parseAmount(amount, 6)
  const [stx, nonces, rate] = await Promise.all([
    rest<{ balance?: string; locked?: string }>(endpoint, `/extended/v1/address/${from}/stx`, fetcher),
    rest<{ possible_next_nonce?: number }>(endpoint, `/extended/v1/address/${from}/nonces`, fetcher),
    rest<number>(endpoint, '/v2/fees/transfer', fetcher),
  ])
  if (stx?.balance === undefined || nonces?.possible_next_nonce === undefined) throw new Error('The Stacks API is currently unavailable.')
  const draft = { signer: stacksDecode(from).hash, nonce: BigInt(nonces.possible_next_nonce), fee: 0n, to: target, amount: value, memo: memo.trim() }
  // Fee per byte from the node, with a floor that confirms in normal blocks.
  const size = BigInt(stacksTransfer(draft).length)
  const fee = [BigInt(Math.max(1, Number(rate) || 1)) * size, 3_000n].reduce((left, right) => left > right ? left : right)
  const available = BigInt(stx.balance) - BigInt(stx.locked ?? '0')
  if (available < value + fee) throw new Error('Insufficient STX to cover the amount and network fee.')
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 6), fee: formatAmount(fee, 6), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'stacks')
      try {
        sameWallet(from, stacksAddress(secp256k1.getPublicKey(key, true)))
        const { signed, txid } = stacksSign({ ...draft, fee }, key)
        return { hash: `0x${txid}`, async broadcast() {
          const reply = await rest<string | { error?: string; reason?: string }>(endpoint, '/v2/transactions', fetcher, hex.encode(signed), 'text/plain')
          if (reply !== txid && reply !== `0x${txid}`) throw new Error(typeof reply === 'object' && reply?.reason ? `Stacks rejected the transfer: ${reply.reason}` : 'Stacks submission is unverified.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function stacksStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^0x[a-f\d]{64}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const tx = await rest<{ tx_status?: string }>(endpoint, `/extended/v1/tx/${item.hash}`, fetcher)
  if (tx?.tx_status === 'success') return 'confirmed'
  if (tx?.tx_status?.startsWith('abort') || tx?.tx_status?.startsWith('dropped')) return 'failed'
  return item.status
}
