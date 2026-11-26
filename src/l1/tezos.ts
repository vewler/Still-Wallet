import { base58check, hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { concat, notOwn, rest, sameWallet, type Fetcher } from './common'
import { l1PrivateKey } from './keys'

const b58 = base58check(sha256)
const prefix = { tz1: [6, 161, 159], tz2: [6, 161, 161], tz3: [6, 161, 164], KT1: [2, 90, 121], edpk: [13, 15, 37, 217], block: [1, 52], operation: [5, 116] } as const
const chainId = 'NetXdQprcVkpaWU'

export function tezosAddress(publicKey: Uint8Array) {
  return b58.encode(concat(prefix.tz1, blake2b(publicKey, { dkLen: 20 })))
}

function unprefix(value: string, kind: readonly number[], length: number) {
  const bytes = b58.decode(value)
  if (bytes.length !== kind.length + length || kind.some((byte, index) => bytes[index] !== byte)) throw new Error('Wrong prefix.')
  return bytes.slice(kind.length)
}

/** Forged destination: implicit accounts are 0x00 + curve tag + hash, contracts 0x01 + hash + 0x00. */
export function tezosDestination(address: string) {
  const value = address.trim()
  try {
    if (value.startsWith('KT1')) return concat([1], unprefix(value, prefix.KT1, 20), [0])
    const tag = ['tz1', 'tz2', 'tz3'].indexOf(value.slice(0, 3))
    if (tag >= 0) return concat([0, tag], unprefix(value, prefix[value.slice(0, 3) as 'tz1'], 20))
  } catch { /* Fall through. */ }
  throw new Error('Enter a valid Tezos address (tz1…, tz2…, tz3… or KT1…).')
}

function zarith(value: bigint) {
  const out: number[] = []
  let rest = value
  do {
    let byte = Number(rest & 0x7fn)
    rest >>= 7n
    if (rest > 0n) byte |= 0x80
    out.push(byte)
  } while (rest > 0n)
  return Uint8Array.from(out)
}

type Manager = { fee: bigint; counter: bigint; gas: bigint; storage: bigint }
const manager = (source: Uint8Array, fields: Manager) => concat(source, zarith(fields.fee), zarith(fields.counter), zarith(fields.gas), zarith(fields.storage))

export function tezosReveal(source: Uint8Array, publicKey: Uint8Array, fields: Manager) {
  return concat([107], manager(source, fields), [0], publicKey, [0])
}

export function tezosTransaction(source: Uint8Array, to: Uint8Array, amount: bigint, fields: Manager) {
  return concat([108], manager(source, fields), zarith(amount), to, [0])
}

export function tezosSign(branch: string, contents: Uint8Array, key: Uint8Array) {
  const forged = concat(unprefix(branch, prefix.block, 32), contents)
  const signature = ed25519.sign(blake2b(concat([3], forged), { dkLen: 32 }), key)
  const signed = concat(forged, signature)
  return { signed: hex.encode(signed), hash: b58.encode(concat(prefix.operation, blake2b(signed, { dkLen: 32 }))) }
}

const head = '/chains/main/blocks/head'

export async function checkTezos(endpoint: string, fetcher: Fetcher) {
  const header = await rest<{ chain_id?: string }>(endpoint, `${head}/header`, fetcher)
  if (header?.chain_id !== chainId) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function tezosBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  return BigInt(await rest<string>(endpoint, `${head}/context/contracts/${owner}/balance`, fetcher) ?? '0')
}

// Conservative limits for a plain tez transfer, unused gas isn't charged but counts toward the minimal fee.
const gasLimit = 1_200n
const newAccountStorage = 277n
const costPerByte = 250n

export async function quoteTezos(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: Fetcher): Promise<Quote> {
  const to = tezosDestination(recipient)
  const target = recipient.trim()
  notOwn(from, target)
  const value = parseAmount(amount, 6)
  const [header, balance, counter, managerKey, targetBalance] = await Promise.all([
    rest<{ hash?: string; chain_id?: string; level?: number }>(endpoint, `${head}/header`, fetcher),
    tezosBalance(endpoint, from, fetcher),
    rest<string>(endpoint, `${head}/context/contracts/${from}/counter`, fetcher),
    rest<string | null>(endpoint, `${head}/context/contracts/${from}/manager_key`, fetcher),
    target.startsWith('KT1') ? Promise.resolve(1n) : tezosBalance(endpoint, target, fetcher),
  ])
  if (header?.chain_id !== chainId || !header.hash) throw new Error('Tezos network fees are currently unavailable.')
  if (counter === undefined || balance === 0n) throw new Error('Insufficient tez. Receive some XTZ first to activate this address.')
  if (target.startsWith('KT1')) throw new Error('Still sends tez to wallet addresses (tz…) only.')
  const reveal = !managerKey
  const storage = targetBalance === 0n ? newAccountStorage : 0n
  const source = tezosDestination(from).subarray(1)
  const next = BigInt(counter) + 1n
  // Minimal fee: 100 mutez + 0.1 per gas unit + 1 per byte, with headroom.
  const fee = (bytes: number) => 100n + gasLimit / 10n + BigInt(bytes) + 100n
  const draft = (revealFee: bigint, sendFee: bigint, publicKey: Uint8Array) => concat(
    reveal ? tezosReveal(source, publicKey, { fee: revealFee, counter: next, gas: gasLimit, storage: 0n }) : new Uint8Array(),
    tezosTransaction(source, to, value, { fee: sendFee, counter: reveal ? next + 1n : next, gas: gasLimit, storage }),
  )
  const size = draft(1000n, 1000n, new Uint8Array(32)).length + 32 + 64
  const revealFee = reveal ? fee(Math.ceil(size / 2)) : 0n
  const sendFee = fee(reveal ? Math.ceil(size / 2) : size)
  const burn = storage * costPerByte
  const total = revealFee + sendFee + burn
  if (balance < value + total) throw new Error(`Insufficient tez to cover the amount and network fee${burn ? ', including 0.06425 tez to activate the new address' : ''}.`)
  const expires = Date.now() + 60_000
  return {
    to: target, value: formatAmount(value, 6), fee: formatAmount(total, 6), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'tezos')
      try {
        const publicKey = ed25519.getPublicKey(key)
        sameWallet(from, tezosAddress(publicKey))
        const { signed, hash } = tezosSign(header.hash!, draft(revealFee, sendFee, publicKey), key)
        const last = reveal ? next + 1n : next
        // lastValidBlockHeight keeps the level the operation's branch points at, it can only land after it.
        return { hash, from, lastLedgerSequence: Number(last), lastValidBlockHeight: header.level, async broadcast() {
          const reply = await rest<string>(endpoint, '/injection/operation', fetcher, JSON.stringify(signed))
          if (reply !== hash) throw new Error('Tezos rejected the transfer.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function tezosStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!item.from || !item.lastLedgerSequence) return item.status
  const counter = await rest<string>(endpoint, `${head}/context/contracts/${item.from}/counter`, fetcher)
  const used = counter !== undefined && BigInt(counter) >= BigInt(item.lastLedgerSequence)
  // Sent before Still kept the level: the counter is all there is to go on.
  if (item.lastValidBlockHeight === undefined) return used ? 'confirmed' : Date.now() - item.created > 30 * 60_000 ? 'expired' : item.status
  if (!used) return Date.now() - item.created > 30 * 60_000 ? 'expired' : item.status
  // The counter moved, but that only means some operation used it: find this one and read its result.
  const top = (await rest<{ level?: number }>(endpoint, `${head}/header`, fetcher))?.level
  if (!top) return item.status
  // Operations only stay valid for a few hundred blocks after their branch.
  const last = Math.min(top, item.lastValidBlockHeight + 500)
  for (let start = item.lastValidBlockHeight + 1; start <= last; start += 10) {
    const levels = Array.from({ length: Math.min(10, last - start + 1) }, (_, index) => start + index)
    const lists = await Promise.all(levels.map((level) => rest<string[]>(endpoint, `/chains/main/blocks/${level}/operation_hashes/3`, fetcher)))
    for (const [index, list] of lists.entries()) {
      const position = list?.indexOf(item.hash) ?? -1
      if (position < 0) continue
      const operation = await rest<{ contents?: { metadata?: { operation_result?: { status?: string } } }[] }>(endpoint, `/chains/main/blocks/${levels[index]}/operations/3/${position}`, fetcher)
      const results = (operation?.contents ?? []).map((content) => content.metadata?.operation_result?.status)
      return results.length && results.every((status) => status === 'applied') ? 'confirmed' : 'failed'
    }
  }
  // Another operation used the counter, so this one can never land.
  return 'failed'
}
