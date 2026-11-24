import { hex } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import type { HDKey } from '@scure/bip32'
import { base58Decode, bitcoinCashAddress, bitcoinCashKey, cashDecode, hash160, zcashAddress, zcashKey } from './keys'
import { formatAmount, parseAmount, type Network } from './networks'
import type { Quote } from './rpc'

/** Bitcoin Cash and transparent Zcash: legacy P2PKH coins whose signatures commit to input amounts,
 *  so no previous transactions are needed (BIP-143 with FORKID for BCH, ZIP-244 for Zcash). */

const hashPattern = /^[a-f\d]{64}$/i
const dsha = (data: Uint8Array) => sha256(sha256(data))

export type Input = { txid: string; vout: number; value: bigint }
export type Output = { script: Uint8Array; value: bigint }

function u32(value: number) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out }
function u64(value: bigint) { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return out }
function varint(value: number) {
  if (value < 0xfd) return new Uint8Array([value])
  if (value <= 0xffff) return new Uint8Array([0xfd, value & 0xff, value >> 8])
  return new Uint8Array([0xfe, ...u32(value)])
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}
const withLength = (bytes: Uint8Array) => concat(varint(bytes.length), bytes)
/** Txids are shown byte-reversed. */
const outpoint = (input: Input) => concat(hex.decode(input.txid).reverse(), u32(input.vout))

export const p2pkhScript = (hash: Uint8Array) => concat(new Uint8Array([0x76, 0xa9, 0x14]), hash, new Uint8Array([0x88, 0xac]))
const p2shScript = (hash: Uint8Array) => concat(new Uint8Array([0xa9, 0x14]), hash, new Uint8Array([0x87]))
const output = (out: Output) => concat(u64(out.value), withLength(out.script))

function signDer(digest: Uint8Array, key: HDKey, hashType: number) {
  const signature = secp256k1.sign(digest, key.privateKey!, { prehash: false, lowS: true, format: 'der' })
  return concat(signature, new Uint8Array([hashType]))
}
const scriptSig = (signature: Uint8Array, publicKey: Uint8Array) => concat(withLength(signature), withLength(publicKey))

/** Recipient script for a Bitcoin Cash CashAddr or legacy (1…/3…) address. */
export function bitcoinCashScript(value: string) {
  const text = value.trim()
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text)) {
    const bytes = base58Decode(text)
    if (bytes.length !== 21 || (bytes[0] !== 0 && bytes[0] !== 5)) throw new Error('Not a Bitcoin Cash address.')
    return bytes[0] === 0 ? p2pkhScript(bytes.subarray(1)) : p2shScript(bytes.subarray(1))
  }
  const { version, hash } = cashDecode('bitcoincash', text)
  if (hash.length !== 20 || (version !== 0 && version !== 8)) throw new Error('Not a Bitcoin Cash address.')
  return version === 0 ? p2pkhScript(hash) : p2shScript(hash)
}

/** Recipient script for a transparent Zcash address (t1… or t3…). */
export function zcashScript(value: string) {
  const bytes = base58Decode(value.trim())
  if (bytes.length !== 22 || bytes[0] !== 0x1c || (bytes[1] !== 0xb8 && bytes[1] !== 0xbd)) throw new Error('Not a transparent Zcash address.')
  return bytes[1] === 0xb8 ? p2pkhScript(bytes.subarray(2)) : p2shScript(bytes.subarray(2))
}

/** Signed BCH transaction (version 2, SIGHASH_ALL | FORKID). */
export function signBitcoinCash(inputs: Input[], outputs: Output[], key: HDKey) {
  const publicKey = key.publicKey!
  const script = p2pkhScript(hash160(publicKey))
  const version = u32(2)
  const lockTime = u32(0)
  const sequence = u32(0xffff_ffff)
  const hashPrevouts = dsha(concat(...inputs.map(outpoint)))
  const hashSequence = dsha(concat(...inputs.map(() => sequence)))
  const hashOutputs = dsha(concat(...outputs.map(output)))
  const scripts = inputs.map((input) => {
    const preimage = concat(version, hashPrevouts, hashSequence, outpoint(input), withLength(script), u64(input.value), sequence, hashOutputs, lockTime, u32(0x41))
    return scriptSig(signDer(dsha(preimage), key, 0x41), publicKey)
  })
  const raw = concat(version, varint(inputs.length), ...inputs.map((input, index) => concat(outpoint(input), withLength(scripts[index]), sequence)),
    varint(outputs.length), ...outputs.map(output), lockTime)
  return { raw: hex.encode(raw), id: hex.encode(dsha(raw).reverse()) }
}

/** NU7 (ZIP 259) is the current Zcash consensus branch. Signatures commit to it. */
export const zcashBranch = { id: 0x77190ad9, height: 3_543_405 }

const personal = (text: string) => new TextEncoder().encode(text)
const zhash = (tag: string | Uint8Array, ...parts: Uint8Array[]) =>
  blake2b(concat(...parts), { dkLen: 32, personalization: typeof tag === 'string' ? personal(tag) : tag })

/** Signed transparent-only Zcash v5 transaction (ZIP 225 format, ZIP 244 signatures). */
export function signZcash(inputs: Input[], outputs: Output[], key: HDKey, expiryHeight: number, branch = zcashBranch.id) {
  const publicKey = key.publicKey!
  const script = p2pkhScript(hash160(publicKey))
  const header = concat(u32(0x80000005), u32(0x26a7270a), u32(branch), u32(0), u32(expiryHeight))
  const headerDigest = zhash('ZTxIdHeadersHash', header)
  const sequence = u32(0xffff_ffff)
  const prevouts = zhash('ZTxIdPrevoutHash', ...inputs.map(outpoint))
  const sequences = zhash('ZTxIdSequencHash', ...inputs.map(() => sequence))
  const outs = zhash('ZTxIdOutputsHash', ...outputs.map(output))
  const amounts = zhash('ZTxTrAmountsHash', ...inputs.map((input) => u64(input.value)))
  const scriptsDigest = zhash('ZTxTrScriptsHash', ...inputs.map(() => withLength(script)))
  const sapling = zhash('ZTxIdSaplingHash')
  const orchard = zhash('ZTxIdOrchardHash')
  const txTag = concat(personal('ZcashTxHash_'), u32(branch))
  const sigs = inputs.map((input) => {
    const txin = zhash('Zcash___TxInHash', outpoint(input), u64(input.value), withLength(script), sequence)
    const transparent = zhash('ZTxIdTranspaHash', new Uint8Array([1]), prevouts, amounts, scriptsDigest, sequences, outs, txin)
    return scriptSig(signDer(zhash(txTag, headerDigest, transparent, sapling, orchard), key, 1), publicKey)
  })
  const raw = concat(header, varint(inputs.length), ...inputs.map((input, index) => concat(outpoint(input), withLength(sigs[index]), sequence)),
    varint(outputs.length), ...outputs.map(output), new Uint8Array([0, 0, 0]))
  const id = zhash(txTag, headerDigest, zhash('ZTxIdTranspaHash', prevouts, sequences, outs), sapling, orchard)
  return { raw: hex.encode(raw), id: hex.encode(id.reverse()) }
}

type Utxo = { txid: string; vout: number; value: number; status?: { confirmed?: boolean } }

type ForkParams = {
  name: string
  symbol: string
  dust: bigint
  /** Fee in base units for a transaction with these input and output counts. */
  fee: (inputs: number, outputs: number) => bigint
  recipient: (value: string) => Uint8Array
  key: (phrase: string, account: number) => Promise<HDKey>
  address: (publicKey: Uint8Array) => string
  /** Address as the provider path wants it. */
  apiAddress: (address: string) => string
  sign: (inputs: Input[], outputs: Output[], key: HDKey, height: number) => { raw: string; id: string }
  height?: (endpoint: string, fetcher: typeof fetch) => Promise<number>
}

const forks: Record<'bitcoincash' | 'zcash', ForkParams> = {
  bitcoincash: {
    name: 'Bitcoin Cash', symbol: 'BCH', dust: 546n,
    // P2PKH: 148 bytes per input (worst case signature), 34 per output, 10 overhead, at 1 sat/byte.
    fee: (inputs, outputs) => BigInt(10 + 148 * inputs + 34 * outputs),
    recipient: bitcoinCashScript, key: bitcoinCashKey, address: bitcoinCashAddress,
    apiAddress: (address) => address.replace(/^bitcoincash:/, ''),
    sign: (inputs, outputs, key) => signBitcoinCash(inputs, outputs, key),
  },
  zcash: {
    name: 'Zcash', symbol: 'ZEC', dust: 5_460n,
    // ZIP 317: 5000 zatoshis per logical action, at least 2.
    fee: (inputs, outputs) => 5_000n * BigInt(Math.max(2, inputs, outputs)),
    recipient: zcashScript, key: zcashKey, address: zcashAddress, apiAddress: (address) => address,
    // Valid for about 100 blocks (40 minutes).
    sign: (inputs, outputs, key, height) => signZcash(inputs, outputs, key, height + 100),
    async height(endpoint, fetcher) {
      const result = await api(endpoint, '/blocks/tip/height', fetcher)
      if (!result.ok) throw new Error('The Zcash provider could not load the block height.')
      const height = Number((await result.text()).trim())
      if (!Number.isSafeInteger(height) || height < zcashBranch.height) throw new Error('The Zcash provider is behind the network.')
      return height
    },
  },
}

export const bitcoinCashApiAddress = forks.bitcoincash.apiAddress

function api(endpoint: string, path: string, fetcher: typeof fetch, options?: RequestInit) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/+$/, '') + path
  return fetcher(url, options)
}

export async function quoteFork(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: typeof fetch): Promise<Quote> {
  const params = forks[network.chain as keyof typeof forks]
  if (!params) throw new Error('Unsupported network.')
  const { name, symbol } = params
  let toScript: Uint8Array
  try { toScript = params.recipient(recipient) } catch { throw new Error(`Enter a valid ${name} mainnet address.`) }
  const to = recipient.trim()
  const ownScript = params.recipient(from)
  if (hex.encode(toScript) === hex.encode(ownScript)) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, 8)
  if (value < params.dust || value > 10n ** 17n) throw new Error(`Enter at least ${formatAmount(params.dust, 8)} ${symbol}.`)
  const [unspent, height] = await Promise.all([
    api(endpoint, `/address/${params.apiAddress(from)}/utxo`, fetcher).then(async (result) => {
      if (!result.ok) throw new Error(`The ${name} provider could not load your coins.`)
      return await result.json() as Utxo[]
    }),
    params.height?.(endpoint, fetcher) ?? 0,
  ])
  const seen = new Set<string>()
  const candidates = (Array.isArray(unspent) ? unspent : []).filter((utxo) => {
    const key = `${utxo.txid}:${utxo.vout}`.toLowerCase()
    if (!utxo.status?.confirmed || !hashPattern.test(utxo.txid) || !Number.isInteger(utxo.vout) || utxo.vout < 0 || utxo.vout > 0xffff_ffff ||
      !Number.isSafeInteger(utxo.value) || utxo.value <= 0 || seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => b.value - a.value).slice(0, 24)
  if (!candidates.length) throw new Error(`There is no confirmed ${symbol} to spend from this address.`)
  const inputs: Input[] = []
  let total = 0n
  let fee = 0n
  let change = 0n
  for (const utxo of candidates) {
    inputs.push({ txid: utxo.txid.toLowerCase(), vout: utxo.vout, value: BigInt(utxo.value) })
    total += BigInt(utxo.value)
    fee = params.fee(inputs.length, 2)
    if (total >= value + fee) break
  }
  if (total < value + fee) {
    // Without change the fee can be lower.
    fee = params.fee(inputs.length, 1)
    if (total < value + fee) throw new Error(`Insufficient confirmed ${symbol} in the available inputs to cover this amount and fee.`)
  }
  change = total - value - fee
  if (change < params.dust) { fee += change; change = 0n }
  const outputs: Output[] = [{ script: toScript, value }, ...(change ? [{ script: ownScript, value: change }] : [])]
  const expires = Date.now() + 45_000
  return {
    to, value: formatAmount(value, 8), fee: formatAmount(fee, 8), network, expires,
    async sign(session) {
      const key = await params.key(session.mnemonic, session.account)
      let signed: { raw: string; id: string }
      try {
        if (params.address(key.publicKey!) !== from) throw new Error('This quote belongs to a different wallet.')
        signed = params.sign(inputs, outputs, key, height)
      } finally {
        key.wipePrivateData()
      }
      const { raw, id: hash } = signed
      return { hash, async broadcast() {
        const result = await api(endpoint, '/tx', fetcher, { method: 'POST', body: raw, headers: { 'Content-Type': 'text/plain' } })
        if (!result.ok || (await result.text()).trim().toLowerCase() !== hash) throw new Error(`${name} submission is unverified.`)
      } }
    },
  }
}
