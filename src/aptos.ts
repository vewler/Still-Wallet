import { ed25519 } from '@noble/curves/ed25519.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { formatAmount, parseAmount, type Network } from './networks'
import type { ActivityItem } from './storage'
import type { Quote } from './rpc'
import { aptosAddress, aptosKey } from './vault'

const chainId = 1
const addressPattern = /^0x[a-f\d]{64}$/i
const hashPattern = /^0x[a-f\d]{64}$/i

/** Aptos node REST API (/v1), through the Still gateway by default. */
async function aptosRequest(endpoint: string, path: string, fetcher: typeof fetch, body?: Uint8Array) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/+$/, '') + path
  return fetcher(url, body ? { method: 'POST', headers: { 'content-type': 'application/x.aptos.signed_transaction+bcs' }, body: body as Uint8Array<ArrayBuffer> } : undefined)
}

async function aptosJson<T>(endpoint: string, path: string, fetcher: typeof fetch, body?: Uint8Array) {
  const response = await aptosRequest(endpoint, path, fetcher, body)
  if (!response.ok) throw new Error('The Aptos provider returned an unsuccessful response.')
  return await response.json() as T
}

export async function checkAptos(endpoint: string, fetcher: typeof fetch) {
  const info = await aptosJson<{ chain_id?: number }>(endpoint, '', fetcher)
  if (info.chain_id !== chainId) throw new Error('The provider is connected to a different Aptos network.')
}

export async function aptosBalance(endpoint: string, owner: string, fetcher: typeof fetch) {
  const response = await aptosRequest(endpoint, `/accounts/${owner}/balance/0x1::aptos_coin::AptosCoin`, fetcher)
  // A new address has no account yet.
  if (response.status === 404) return 0n
  if (!response.ok) throw new Error('The Aptos provider returned an unsuccessful response.')
  const value = await response.json() as unknown
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('The Aptos provider did not return a balance.')
  return BigInt(value)
}

// Minimal BCS writer for an APT transfer.
function uleb(value: number) {
  const out: number[] = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value) byte |= 0x80
    out.push(byte)
  } while (value)
  return out
}
function u64(value: bigint) {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, value, true)
  return [...out]
}
const bytes = (data: Uint8Array | number[]) => [...uleb(data.length), ...data]
const text = (value: string) => bytes(utf8ToBytes(value))

type RawParams = { sender: Uint8Array; sequence: bigint; to: Uint8Array; amount: bigint; maxGas: bigint; gasPrice: bigint; expiration: bigint }

/** RawTransaction with an entry function call to 0x1::aptos_account::transfer, which also creates new accounts. */
export function encodeTransfer(params: RawParams) {
  const framework = new Uint8Array(32)
  framework[31] = 1
  return Uint8Array.from([
    ...params.sender, ...u64(params.sequence),
    2, ...framework, ...text('aptos_account'), ...text('transfer'), ...uleb(0),
    ...uleb(2), ...bytes(params.to), ...bytes(u64(params.amount)),
    ...u64(params.maxGas), ...u64(params.gasPrice), ...u64(params.expiration), chainId,
  ])
}

/** SignedTransaction: raw + Ed25519 authenticator. */
export function encodeSigned(raw: Uint8Array, publicKey: Uint8Array, signature: Uint8Array) {
  return Uint8Array.from([...raw, 0, ...bytes(publicKey), ...bytes(signature)])
}

export function signingMessage(raw: Uint8Array) {
  return Uint8Array.from([...sha3_256(utf8ToBytes('APTOS::RawTransaction')), ...raw])
}

export function transactionHash(signed: Uint8Array) {
  return '0x' + bytesToHex(sha3_256(Uint8Array.from([...sha3_256(utf8ToBytes('APTOS::Transaction')), 0, ...signed])))
}

type Simulation = { success?: boolean; gas_used?: string; vm_status?: string }

export async function quoteAptos(network: Network, endpoint: string, from: string, publicKeyHex: string, recipient: string, amount: string, fetcher: typeof fetch): Promise<Quote> {
  const to = recipient.trim().toLowerCase()
  if (!addressPattern.test(to)) throw new Error('Enter a valid Aptos address (0x and 64 characters).')
  if (to === from) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, network.decimals)
  if (value >= 2n ** 64n) throw new Error('Enter a smaller amount.')
  await checkAptos(endpoint, fetcher)
  const [balance, account, price] = await Promise.all([
    aptosBalance(endpoint, from, fetcher),
    aptosRequest(endpoint, `/accounts/${from}`, fetcher).then(async (response) => {
      if (response.status === 404) return { sequence_number: '0' }
      if (!response.ok) throw new Error('The Aptos provider returned an unsuccessful response.')
      return await response.json() as { sequence_number?: string }
    }),
    aptosJson<{ gas_estimate?: number }>(endpoint, '/estimate_gas_price', fetcher),
  ])
  if (!/^\d+$/.test(account.sequence_number ?? '') || !price.gas_estimate || price.gas_estimate <= 0) throw new Error('Aptos network fees are currently unavailable.')
  const gasPrice = BigInt(price.gas_estimate)
  if (balance <= value) throw new Error('Insufficient APT to cover the amount and network fee.')
  const sequence = BigInt(account.sequence_number!)
  const sender = hexToBytes(from.slice(2))
  const target = hexToBytes(to.slice(2))
  const expiration = BigInt(Math.floor(Date.now() / 1000) + 120)
  // Test run with a blank signature, the node rejects real ones here.
  const room = (balance - value) / gasPrice
  const testGas = room < 20_000n ? room : 20_000n
  if (testGas < 10n) throw new Error('Insufficient APT to cover the amount and network fee.')
  const testRaw = encodeTransfer({ sender, sequence, to: target, amount: value, maxGas: testGas, gasPrice, expiration })
  const publicKey = hexToBytes(publicKeyHex)
  if (aptosAddress(publicKey) !== from) throw new Error('This quote belongs to a different wallet.')
  const [simulation] = await aptosJson<Simulation[]>(endpoint, '/transactions/simulate', fetcher, encodeSigned(testRaw, publicKey, new Uint8Array(64)))
  const used = BigInt(simulation?.gas_used ?? 0)
  if (!simulation?.success || used <= 0n) {
    throw new Error(/INSUFFICIENT_BALANCE|EINSUFFICIENT/.test(simulation?.vm_status ?? '') ? 'Insufficient APT to cover the amount and network fee.' : 'The network rejected this transaction in a test run. Check the amount and balance, then try again.')
  }
  const maxGas = used * 3n / 2n + 50n
  if (balance < value + maxGas * gasPrice) throw new Error('Insufficient APT to cover the amount and network fee.')
  const raw = encodeTransfer({ sender, sequence, to: target, amount: value, maxGas, gasPrice, expiration })
  const expires = Date.now() + 45_000
  return {
    to, value: formatAmount(value, network.decimals), fee: formatAmount(used * gasPrice, network.decimals), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const secret = await aptosKey(session.mnemonic, session.account)
      try {
        const publicKey = ed25519.getPublicKey(secret)
        if (aptosAddress(publicKey) !== from) throw new Error('This quote belongs to a different wallet.')
        const signed = encodeSigned(raw, publicKey, ed25519.sign(signingMessage(raw), secret))
        const hash = transactionHash(signed)
        return {
          hash,
          async broadcast() {
            const reply = await aptosJson<{ hash?: string }>(endpoint, '/transactions', fetcher, signed)
            if (reply.hash?.toLowerCase() !== hash) throw new Error('The provider returned an unexpected transaction ID.')
          },
        }
      } finally {
        secret.fill(0)
      }
    },
  }
}

export async function aptosStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!hashPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  const response = await aptosRequest(endpoint, `/transactions/by_hash/${item.hash.toLowerCase()}`, fetcher)
  if (response.status === 404) return item.status
  if (!response.ok) throw new Error('The Aptos provider returned an unsuccessful response.')
  const tx = await response.json() as { type?: string; success?: boolean }
  if (tx.type === 'pending_transaction') return item.status
  return tx.success ? 'confirmed' : 'failed'
}
