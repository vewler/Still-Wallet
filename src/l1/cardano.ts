import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { bech32, hex } from '@scure/base'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { concat, notOwn, rest, sameWallet, type Fetcher } from './common'

/** Cardano Icarus (CIP-3) BIP32-Ed25519 keys, CIP-1852 paths, like Eternl, Lace and Yoroi. */
type Node = { kL: Uint8Array; kR: Uint8Array; chain: Uint8Array }
const L = ed25519.Point.Fn.ORDER
const le = (bytes: Uint8Array) => BigInt('0x' + hex.encode(Uint8Array.from(bytes).reverse() as Uint8Array) || '0')
const toLe = (value: bigint, size: number) => Uint8Array.from(hex.decode(value.toString(16).padStart(size * 2, '0')).reverse())
const index32 = (index: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, index >>> 0, true); return out }
const publicOf = (kL: Uint8Array) => ed25519.Point.BASE.multiply(le(kL) % L).toBytes()

function master(phrase: string): Node {
  const entropy = mnemonicToEntropy(phrase, wordlist)
  const data = pbkdf2(sha512, new Uint8Array(), entropy, { c: 4096, dkLen: 96 })
  entropy.fill(0)
  data[0] &= 0xf8
  data[31] &= 0x1f
  data[31] |= 0x40
  return { kL: data.slice(0, 32), kR: data.slice(32, 64), chain: data.slice(64, 96) }
}

function child(node: Node, index: number): Node {
  const hard = index >= 0x80000000
  const body = hard ? concat(node.kL, node.kR) : publicOf(node.kL)
  const z = hmac(sha512, node.chain, concat([hard ? 0 : 2], body, index32(index)))
  const c = hmac(sha512, node.chain, concat([hard ? 1 : 3], body, index32(index)))
  const kL = toLe(8n * le(z.subarray(0, 28)) + le(node.kL), 32)
  const kR = toLe((le(z.subarray(32)) + le(node.kR)) % 2n ** 256n, 32)
  z.fill(0)
  return { kL, kR, chain: c.slice(32) }
}

const H = 0x80000000
function walk(node: Node, path: number[]) {
  for (const index of path) {
    const next = child(node, index)
    node.kL.fill(0); node.kR.fill(0)
    node = next
  }
  return node
}

/** Ed25519 signature with an extended (already hashed) key. */
export function cardanoSign(node: Node, message: Uint8Array) {
  const publicKey = publicOf(node.kL)
  const r = le(sha512(concat(node.kR, message))) % L
  const R = ed25519.Point.BASE.multiply(r).toBytes()
  const h = le(sha512(concat(R, publicKey, message))) % L
  const S = (r + h * le(node.kL)) % L
  return concat(R, toLe(S, 32))
}

const keyHash = (publicKey: Uint8Array) => blake2b(publicKey, { dkLen: 28 })

export function cardanoKeys(phrase: string, account: number) {
  const root = walk(master(phrase), [1852 + H, 1815 + H, account + H])
  const copy = { kL: root.kL.slice(), kR: root.kR.slice(), chain: root.chain }
  return { payment: walk(root, [0, 0]), stake: walk(copy, [2, 0]) }
}

export function cardanoAddress(phrase: string, account: number) {
  const { payment, stake } = cardanoKeys(phrase, account)
  try {
    const bytes = concat([0x01], keyHash(publicOf(payment.kL)), keyHash(publicOf(stake.kL)))
    return bech32.encode('addr', bech32.toWords(bytes), 200)
  } finally { for (const node of [payment, stake]) { node.kL.fill(0); node.kR.fill(0) } }
}

function decode(address: string) {
  try {
    const { prefix, words } = bech32.decode(address.trim() as `${string}1${string}`, 200)
    const bytes = Uint8Array.from(bech32.fromWords(words))
    const type = bytes[0] >> 4
    // Shelley mainnet payment addresses (base, script, pointer, enterprise).
    if (prefix === 'addr' && (bytes[0] & 0x0f) === 1 && type <= 7 && bytes.length >= 29) return bytes
  } catch { /* Fall through. */ }
  throw new Error('Enter a valid Cardano address (addr1…).')
}

/** Minimal CBOR for transactions. */
type Cbor = number | bigint | Uint8Array | Cbor[] | Map<number, Cbor> | boolean | null
function head(major: number, value: bigint | number) {
  const n = BigInt(value)
  if (n < 24n) return Uint8Array.of((major << 5) | Number(n))
  for (const [extra, size] of [[24, 1], [25, 2], [26, 4], [27, 8]] as const) {
    if (n < 1n << BigInt(size * 8)) return concat([(major << 5) | extra], hex.decode(n.toString(16).padStart(size * 2, '0')))
  }
  throw new Error('Value too large.')
}
export function cbor(value: Cbor): Uint8Array {
  if (value === null) return Uint8Array.of(0xf6)
  if (value === true) return Uint8Array.of(0xf5)
  if (value === false) return Uint8Array.of(0xf4)
  if (typeof value === 'number' || typeof value === 'bigint') return head(0, value)
  if (value instanceof Uint8Array) return concat(head(2, value.length), value)
  if (Array.isArray(value)) return concat(head(4, value.length), ...value.map(cbor))
  return concat(head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]))
}

type Utxo = { tx_hash: string; tx_index: number; value: string; asset_list?: unknown[] }
export type Input = { hash: string; index: number; value: bigint }

export function cardanoBody(inputs: Input[], outputs: [Uint8Array, bigint][], fee: bigint, ttl: number) {
  return new Map<number, Cbor>([
    [0, inputs.map((input) => [hex.decode(input.hash), input.index])],
    [1, outputs.map(([address, value]) => [address, value])],
    [2, fee],
    [3, ttl],
  ])
}

export function cardanoTransaction(body: Map<number, Cbor>, witnesses: [Uint8Array, Uint8Array][]) {
  return cbor([body, new Map([[0, witnesses.map(([key, signature]) => [key, signature])]]), true, null])
}

const minimumOutput = 1_000_000n

async function addressInfo(endpoint: string, address: string, fetcher: Fetcher) {
  const reply = await rest<{ balance?: string; utxo_set?: Utxo[] }[]>(endpoint, '/address_info', fetcher, JSON.stringify({ _addresses: [address] }))
  if (!Array.isArray(reply)) throw new Error('The Cardano provider could not load the balance.')
  return reply[0] ?? { balance: '0', utxo_set: [] }
}

export async function checkCardano(endpoint: string, fetcher: Fetcher) {
  const reply = await rest<{ networkid?: string }[]>(endpoint, '/genesis', fetcher)
  if (reply?.[0]?.networkid !== 'mainnet') throw new Error('The RPC endpoint is connected to a different network.')
}

export async function cardanoBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  return BigInt((await addressInfo(endpoint, owner, fetcher)).balance ?? '0')
}

export async function quoteCardano(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: Fetcher): Promise<Quote> {
  const target = decode(recipient)
  const to = recipient.trim()
  notOwn(from, to)
  const value = parseAmount(amount, 6)
  if (value < minimumOutput) throw new Error('Cardano needs at least 1 ADA per transfer.')
  const [info, tip, params] = await Promise.all([
    addressInfo(endpoint, from, fetcher),
    rest<{ abs_slot?: number }[]>(endpoint, '/tip', fetcher),
    rest<{ min_fee_a?: number; min_fee_b?: number }[]>(endpoint, '/epoch_params?limit=1', fetcher),
  ])
  const slot = tip?.[0]?.abs_slot
  if (!slot) throw new Error('Cardano network fees are currently unavailable.')
  const a = BigInt(params?.[0]?.min_fee_a ?? 44)
  const b = BigInt(params?.[0]?.min_fee_b ?? 155_381)
  // Only plain ADA outputs are spent, so native tokens stay where they are.
  const utxos = (info.utxo_set ?? []).filter((utxo) => !utxo.asset_list?.length)
    .map((utxo): Input => ({ hash: utxo.tx_hash, index: utxo.tx_index, value: BigInt(utxo.value) }))
    .sort((left, right) => left.value > right.value ? -1 : left.value < right.value ? 1 : 0)
  const own = decode(from)
  const ttl = slot + 7200
  const dummy: [Uint8Array, Uint8Array] = [new Uint8Array(32), new Uint8Array(64)]
  let fee = 200_000n
  let inputs: Input[] = []
  let outputs: [Uint8Array, bigint][] = []
  let settled = false
  for (let round = 0; round < 5 && !settled; round++) {
    inputs = []
    let total = 0n
    for (const utxo of utxos) {
      if (total >= value + fee + minimumOutput) break
      inputs.push(utxo)
      total += utxo.value
    }
    if (total < value + fee) throw new Error('Insufficient ADA to cover the amount and network fee.')
    const change = total - value - fee
    // Change too small for its own output goes to the fee.
    const paid = change >= minimumOutput ? fee : total - value
    outputs = change >= minimumOutput ? [[target, value], [own, change]] : [[target, value]]
    const needed = a * BigInt(cardanoTransaction(cardanoBody(inputs, outputs, paid, ttl), [dummy]).length) + b
    if (paid >= needed && (change < minimumOutput || paid - needed < 2_000n)) { fee = paid; settled = true } else fee = needed
  }
  if (!settled) throw new Error('Cardano network fees are currently unavailable.')
  if (inputs.length > 100) throw new Error('This wallet has too many small Cardano deposits to send in one go.')
  const body = cardanoBody(inputs, outputs, fee, ttl)
  const bodyBytes = cbor(body)
  const hash = blake2b(bodyBytes, { dkLen: 32 })
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 6), fee: formatAmount(fee, 6), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const { payment, stake } = cardanoKeys(session.mnemonic, session.account)
      try {
        sameWallet(from, bech32.encode('addr', bech32.toWords(concat([0x01], keyHash(publicOf(payment.kL)), keyHash(publicOf(stake.kL)))), 200))
        const raw = cardanoTransaction(body, [[publicOf(payment.kL), cardanoSign(payment, hash)]])
        const id = hex.encode(hash)
        return { hash: id, async broadcast() {
          const reply = await rest<string>(endpoint, '/submittx', fetcher, hex.encode(raw), 'text/plain')
          if (reply !== id) throw new Error('Cardano submission is unverified.')
        } }
      } finally { for (const node of [payment, stake]) { node.kL.fill(0); node.kR.fill(0) } }
    },
  }
}

export async function cardanoStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^[a-f\d]{64}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const reply = await rest<{ num_confirmations?: number | null }[]>(endpoint, '/tx_status', fetcher, JSON.stringify({ _tx_hashes: [item.hash] }))
  return reply?.[0]?.num_confirmations ? 'confirmed' : item.status
}
