import { hex } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { cashDecode, kaspaAddress, kaspaKey } from './keys'
import { formatAmount, parseAmount, type Network } from './networks'
import type { ActivityItem } from './storage'
import type { Quote } from './rpc'

/** Kaspa through a kaspa-rest-server style API (api.kaspa.org). Schnorr P2PK only. */

const hashPattern = /^[a-f\d]{64}$/i
const encoder = new TextEncoder()
const signingKey = encoder.encode('TransactionSigningHash')
const idKey = encoder.encode('TransactionID')

export type KaspaInput = { txid: string; index: number; amount: bigint; script: Uint8Array; sequence?: bigint }
export type KaspaOutput = { amount: bigint; script: Uint8Array }

class Writer {
  parts: Uint8Array[] = []
  bytes(value: Uint8Array) { this.parts.push(value); return this }
  u8(value: number) { return this.bytes(new Uint8Array([value])) }
  u16(value: number) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, true); return this.bytes(out) }
  u32(value: number) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return this.bytes(out) }
  u64(value: bigint | number) { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, BigInt(value), true); return this.bytes(out) }
  varBytes(value: Uint8Array) { return this.u64(value.length).bytes(value) }
  hash(key: Uint8Array) {
    const data = new Uint8Array(this.parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of this.parts) { data.set(part, offset); offset += part.length }
    return blake2b(data, { dkLen: 32, key })
  }
}

/** Pay-to-pubkey (Schnorr) script for a kaspa: address. Version 8 (P2SH) is also accepted for recipients. */
export function kaspaScript(value: string) {
  const { version, hash } = cashDecode('kaspa', value)
  if (version === 0 && hash.length === 32) return new Uint8Array([0x20, ...hash, 0xac])
  if (version === 1 && hash.length === 33) return new Uint8Array([0x21, ...hash, 0xab])
  if (version === 8 && hash.length === 32) return new Uint8Array([0xaa, 0x20, ...hash, 0x87])
  throw new Error('Not a Kaspa address.')
}

const zeroHash = new Uint8Array(32)
const subnetwork = new Uint8Array(20)

/** Kaspa signature hash for one input (SIGHASH_ALL, native subnetwork, no payload). */
export function kaspaSighash(inputs: KaspaInput[], outputs: KaspaOutput[], index: number) {
  const prevouts = new Writer()
  const sequences = new Writer()
  const sigOps = new Writer()
  for (const input of inputs) {
    prevouts.bytes(hex.decode(input.txid)).u32(input.index)
    sequences.u64(input.sequence ?? 0n)
    sigOps.u8(1)
  }
  const outs = new Writer()
  for (const output of outputs) outs.u64(output.amount).u16(0).varBytes(output.script)
  const input = inputs[index]
  return new Writer()
    .u16(0).bytes(prevouts.hash(signingKey)).bytes(sequences.hash(signingKey)).bytes(sigOps.hash(signingKey))
    .bytes(hex.decode(input.txid)).u32(input.index).u16(0).varBytes(input.script).u64(input.amount).u64(input.sequence ?? 0n).u8(1)
    .bytes(outs.hash(signingKey)).u64(0).bytes(subnetwork).u64(0).bytes(zeroHash).u8(1)
    .hash(signingKey)
}

/** Transaction id: the transaction without signature scripts (no payload, no mass commitment). */
export function kaspaTxid(inputs: KaspaInput[], outputs: KaspaOutput[]) {
  const writer = new Writer().u16(0).u64(inputs.length)
  for (const input of inputs) writer.bytes(hex.decode(input.txid)).u32(input.index).varBytes(new Uint8Array()).u64(input.sequence ?? 0n)
  writer.u64(outputs.length)
  for (const output of outputs) writer.u64(output.amount).u16(0).varBytes(output.script)
  writer.u64(0).bytes(subnetwork).u64(0).varBytes(new Uint8Array())
  return hex.encode(writer.hash(idKey))
}

export function signKaspa(inputs: KaspaInput[], outputs: KaspaOutput[], privateKey: Uint8Array) {
  const signatures = inputs.map((_, index) => {
    const signature = schnorr.sign(kaspaSighash(inputs, outputs, index), privateKey)
    return hex.encode(new Uint8Array([0x41, ...signature, 0x01]))
  })
  return {
    id: kaspaTxid(inputs, outputs),
    transaction: {
      version: 0,
      inputs: inputs.map((input, index) => ({ previousOutpoint: { transactionId: input.txid, index: input.index }, signatureScript: signatures[index], sequence: 0, sigOpCount: 1 })),
      outputs: outputs.map((output) => ({ amount: Number(output.amount), scriptPublicKey: { version: 0, scriptPublicKey: hex.encode(output.script) } })),
      lockTime: 0,
      subnetworkId: hex.encode(subnetwork),
    },
  }
}

/** Mass (KIP-9 + KIP-13): the largest of compute, transient and storage mass. Fees are paid per gram. */
export function kaspaMass(inputs: bigint[], outputs: KaspaOutput[]) {
  const size = 2 + 8 + inputs.length * (36 + 8 + 66 + 8 + 1) + 8 + outputs.reduce((sum, output) => sum + 8 + 2 + 8 + output.script.length, 0) + 8 + 20 + 8 + 32 + 8
  const compute = size + outputs.reduce((sum, output) => sum + (2 + output.script.length) * 10, 0) + inputs.length * 1_000
  const C = 10n ** 12n
  const totalIn = inputs.reduce((sum, value) => sum + value, 0n)
  const harmonicOut = outputs.reduce((sum, output) => sum + C / output.amount, 0n)
  const arithmeticIn = BigInt(inputs.length) * BigInt(inputs.length) * C / totalIn
  const storage = harmonicOut > arithmeticIn ? Number(harmonicOut - arithmeticIn) : 0
  return Math.max(compute, size * 4, storage)
}

const maxMass = 100_000
const dust = 20_000_000n

function api(endpoint: string, path: string, fetcher: typeof fetch, options?: RequestInit) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/+$/, '') + path
  return fetcher(url, { ...options, headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) } })
}

async function read<T>(endpoint: string, path: string, fetcher: typeof fetch): Promise<T> {
  const result = await api(endpoint, path, fetcher)
  if (!result.ok) throw new Error('The Kaspa provider returned an unsuccessful response.')
  return await result.json() as T
}

export async function checkKaspa(endpoint: string, fetcher: typeof fetch) {
  const info = await read<{ networkName?: string }>(endpoint, '/info/blockdag', fetcher)
  if (info.networkName !== 'kaspa-mainnet') throw new Error('The provider is connected to a different Kaspa network.')
}

export async function kaspaBalance(endpoint: string, owner: string, fetcher: typeof fetch) {
  const data = await read<{ balance?: unknown }>(endpoint, `/addresses/${owner}/balance`, fetcher)
  const balance = Number(data.balance)
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('The Kaspa provider did not return a balance.')
  return BigInt(balance)
}

type KaspaUtxo = { outpoint?: { transactionId?: string; index?: number }; utxoEntry?: { amount?: string | number; scriptPublicKey?: { scriptPublicKey?: string }; isCoinbase?: boolean } }

export async function quoteKaspa(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: typeof fetch): Promise<Quote> {
  const to = recipient.trim().toLowerCase()
  let toScript: Uint8Array
  try { toScript = kaspaScript(to.includes(':') ? to : `kaspa:${to}`) } catch { throw new Error('Enter a valid Kaspa mainnet address (kaspa:…).') }
  const ownScript = kaspaScript(from)
  if (hex.encode(toScript) === hex.encode(ownScript)) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, 8)
  if (value < dust || value > 3n * 10n ** 18n) throw new Error(`Enter at least ${formatAmount(dust, 8)} KAS.`)
  await checkKaspa(endpoint, fetcher)
  const [unspent, estimate] = await Promise.all([
    read<KaspaUtxo[]>(endpoint, `/addresses/${from}/utxos`, fetcher),
    read<{ normalBuckets?: { feerate?: number }[]; priorityBucket?: { feerate?: number } }>(endpoint, '/info/fee-estimate', fetcher),
  ])
  const rate = Math.max(1, Number(estimate.normalBuckets?.[0]?.feerate ?? estimate.priorityBucket?.feerate))
  if (!Number.isFinite(rate) || rate > 10_000) throw new Error('Kaspa network fees are currently unavailable.')
  const own = hex.encode(ownScript)
  const seen = new Set<string>()
  const candidates = (Array.isArray(unspent) ? unspent : []).flatMap((utxo): KaspaInput[] => {
    const txid = utxo.outpoint?.transactionId
    const index = utxo.outpoint?.index
    const amount = utxo.utxoEntry?.amount
    // Mined coins need to mature, and a wallet only spends its own P2PK outputs.
    if (typeof txid !== 'string' || !hashPattern.test(txid) || !Number.isInteger(index) || index! < 0 || index! > 0xffff_ffff ||
      utxo.utxoEntry?.isCoinbase || utxo.utxoEntry?.scriptPublicKey?.scriptPublicKey?.toLowerCase().replace(/^0000/, '') !== own) return []
    if (!/^\d{1,19}$/.test(String(amount)) || BigInt(amount!) <= 0n) return []
    const key = `${txid}:${index}`.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [{ txid: txid.toLowerCase(), index: index!, amount: BigInt(amount!), script: ownScript }]
  }).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0)).slice(0, 24)
  if (!candidates.length) throw new Error('There is no KAS to spend from this address yet.')
  const feeFor = (inputs: KaspaInput[], outputs: KaspaOutput[]) => {
    const mass = kaspaMass(inputs.map((input) => input.amount), outputs)
    return { mass, fee: BigInt(Math.ceil(mass * rate)) }
  }
  const inputs: KaspaInput[] = []
  let total = 0n
  let outputs: KaspaOutput[] = []
  let fee = 0n
  let mass = 0
  for (const input of candidates) {
    inputs.push(input)
    total += input.amount
    // Estimate with a placeholder change output, then settle the change below.
    const estimate = feeFor(inputs, [{ amount: value, script: toScript }, { amount: dust, script: ownScript }]).fee
    if (total >= value + estimate) break
  }
  ;({ fee, mass } = feeFor(inputs, [{ amount: value, script: toScript }]))
  if (total < value + fee) throw new Error('Insufficient KAS in the available coins to cover this amount and fee.')
  const change = total - value - fee
  outputs = [{ amount: value, script: toScript }]
  if (change >= dust) {
    const withChange = feeFor(inputs, [{ amount: value, script: toScript }, { amount: change, script: ownScript }])
    const settled = total - value - withChange.fee
    if (settled >= dust) {
      outputs.push({ amount: settled, script: ownScript })
      ;({ fee, mass } = withChange)
    } else fee = total - value
  } else fee = total - value
  if (mass > maxMass || kaspaMass(inputs.map((input) => input.amount), outputs) > maxMass) {
    throw new Error('This amount is too small for Kaspa’s storage rules. Send a larger amount.')
  }
  const expires = Date.now() + 45_000
  return {
    to: to.includes(':') ? to : `kaspa:${to}`, value: formatAmount(value, 8), fee: formatAmount(fee, 8), network, expires,
    async sign(session) {
      const key = await kaspaKey(session.mnemonic, session.account)
      let signed: ReturnType<typeof signKaspa>
      try {
        if (kaspaAddress(key.publicKey!) !== from) throw new Error('This quote belongs to a different wallet.')
        signed = signKaspa(inputs, outputs, key.privateKey!)
      } finally {
        key.wipePrivateData()
      }
      const hash = signed.id
      return { hash, async broadcast() {
        const result = await api(endpoint, '/transactions', fetcher, { method: 'POST', body: JSON.stringify({ transaction: signed.transaction, allowOrphan: false }) })
        const reply = await result.json().catch(() => undefined) as { transactionId?: string } | undefined
        if (!result.ok || reply?.transactionId?.toLowerCase() !== hash) throw new Error('Kaspa submission is unverified.')
      } }
    },
  }
}

export async function kaspaStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!hashPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  const result = await api(endpoint, `/transactions/${item.hash.toLowerCase()}`, fetcher)
  if (result.status === 404) { await result.body?.cancel(); return item.status }
  if (!result.ok) throw new Error('Confirmation is unavailable.')
  return (await result.json() as { is_accepted?: boolean }).is_accepted === true ? 'confirmed' : item.status
}
