import { hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { tronAddressBytes, tronDecode, tronEncode, tronKey } from './keys'
import { formatAmount, parseAmount, type Network } from './networks'
import type { ActivityItem } from './storage'
import type { Quote } from './rpc'
import type { Token } from './tokens'

const genesis = '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc'
const hashPattern = /^[a-f\d]{64}$/i
const sun = 1_000_000n

/** Tron's HTTP API (java-tron /wallet/*), through the Still gateway by default. */
export async function tronRequest<T = Record<string, unknown>>(endpoint: string, path: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/+$/, '') + path
  const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('The Tron provider returned an unsuccessful response.')
  return await response.json() as T
}

export async function checkTron(endpoint: string, fetcher: typeof fetch) {
  const block = await tronRequest<{ blockID?: string }>(endpoint, '/wallet/getblockbynum', { num: 0 }, fetcher)
  if (block.blockID !== genesis) throw new Error('The provider is connected to a different Tron network.')
}

export async function tronBalance(endpoint: string, owner: string, fetcher: typeof fetch) {
  const account = await tronRequest<{ balance?: number; address?: string }>(endpoint, '/wallet/getaccount', { address: owner, visible: true }, fetcher)
  // A new address has no account yet: empty reply.
  return BigInt(account.balance ?? 0)
}

const word = (bytes: Uint8Array) => hex.encode(bytes).padStart(64, '0')

type ConstantReply = { result?: { result?: boolean; code?: string; message?: string }; constant_result?: string[]; energy_used?: number; energy_penalty?: number; transaction?: { ret?: { ret?: string; contractRet?: string }[] } }
function constantCall(endpoint: string, owner: string, contract: string, selector: string, parameter: string, fetcher: typeof fetch) {
  return tronRequest<ConstantReply>(endpoint, '/wallet/triggerconstantcontract', {
    owner_address: owner, contract_address: contract, function_selector: selector, parameter, visible: true,
  }, fetcher)
}

async function tokenCall(endpoint: string, owner: string, contract: string, selector: string, parameter: string, fetcher: typeof fetch) {
  const reply = await constantCall(endpoint, owner, contract, selector, parameter, fetcher)
  if (!reply.result?.result || !reply.constant_result?.[0] || !/^[a-f\d]{64}$/i.test(reply.constant_result[0])) throw new Error('The Tron provider could not read the token.')
  return reply
}

/**
 * Test run of a token transfer. Only a revert counts as a failure: Tron USDT's transfer
 * returns false (or nothing) even when it works, so the return value is ignored.
 */
async function transferTest(endpoint: string, owner: string, contract: string, parameter: string, fetcher: typeof fetch) {
  const reply = await constantCall(endpoint, owner, contract, 'transfer(address,uint256)', parameter, fetcher)
  const reverted = !reply.result?.result || Boolean(reply.result.code) || /^08c379a0/i.test(reply.constant_result?.[0] ?? '')
    || Boolean(reply.transaction?.ret?.some((entry) => entry.ret === 'FAILED' || (entry.contractRet !== undefined && entry.contractRet !== 'SUCCESS')))
  if (reverted) throw new Error('The network rejected this transaction in a test run. Check the amount and balances, then try again.')
  return reply
}

export async function tronTokenBalances(endpoint: string, owner: string, list: Token[], fetcher: typeof fetch) {
  const result: Record<string, bigint> = {}
  const holder = word(tronDecode(owner).subarray(1))
  for (const token of list) {
    const reply = await tokenCall(endpoint, owner, token.contract, 'balanceOf(address)', holder, fetcher)
    result[token.id] = BigInt('0x' + reply.constant_result![0])
  }
  return result
}

// Minimal protobuf writer for the two transaction types Still sends.
function varint(value: bigint | number) {
  let rest = BigInt(value)
  const out: number[] = []
  do {
    const byte = Number(rest & 0x7fn)
    rest >>= 7n
    out.push(rest ? byte | 0x80 : byte)
  } while (rest)
  return out
}
const bytesField = (no: number, data: Uint8Array) => [...varint(no << 3 | 2), ...varint(data.length), ...data]
const intField = (no: number, value: bigint | number) => [...varint(no << 3), ...varint(value)]

function contract(type: 1 | 31, name: string, value: number[]) {
  const any = [...bytesField(1, new TextEncoder().encode(`type.googleapis.com/protocol.${name}`)), ...bytesField(2, Uint8Array.from(value))]
  return [...intField(1, type), ...bytesField(2, Uint8Array.from(any))]
}

type RawParams = { refBytes: Uint8Array; refHash: Uint8Array; expiration: number; timestamp: number; feeLimit?: bigint; contract: number[] }

export function encodeRaw(params: RawParams) {
  return Uint8Array.from([
    ...bytesField(1, params.refBytes), ...bytesField(4, params.refHash), ...intField(8, params.expiration),
    ...bytesField(11, Uint8Array.from(params.contract)), ...intField(14, params.timestamp),
    ...(params.feeLimit ? intField(18, params.feeLimit) : []),
  ])
}

export function transferContract(owner: Uint8Array, to: Uint8Array, amount: bigint) {
  return contract(1, 'TransferContract', [...bytesField(1, owner), ...bytesField(2, to), ...intField(3, amount)])
}

export function triggerContract(owner: Uint8Array, target: Uint8Array, data: Uint8Array) {
  return contract(31, 'TriggerSmartContract', [...bytesField(1, owner), ...bytesField(2, target), ...bytesField(4, data)])
}

function recipientBytes(recipient: string) {
  try { return tronDecode(recipient.trim()) } catch { throw new Error('Enter a valid Tron address (starts with T).') }
}

type Resources = { freeNetLimit?: number; freeNetUsed?: number; NetLimit?: number; NetUsed?: number; EnergyLimit?: number; EnergyUsed?: number }
type ChainParameters = { chainParameter?: { key: string; value?: number }[] }

export async function quoteTron(network: Network, endpoint: string, from: string, recipient: string, amount: string, token: Token | undefined, fetcher: typeof fetch): Promise<Quote> {
  const to = recipientBytes(recipient)
  const owner = tronDecode(from)
  const toText = tronEncode(to)
  if (toText === from) throw new Error('Enter an address other than your own.')
  if (token && toText === token.contract) throw new Error(`That is the ${token.symbol} contract itself. Tokens sent there are lost; use the recipient's wallet address.`)
  const decimals = token?.decimals ?? network.decimals
  const value = parseAmount(amount, decimals)
  if (value >= 2n ** 63n) throw new Error('Enter a smaller amount.')
  await checkTron(endpoint, fetcher)
  const [block, balance, target, resources, parameters] = await Promise.all([
    tronRequest<{ blockID?: string; block_header?: { raw_data?: { number?: number; timestamp?: number } } }>(endpoint, '/wallet/getnowblock', {}, fetcher),
    tronBalance(endpoint, from, fetcher),
    tronRequest<{ address?: string }>(endpoint, '/wallet/getaccount', { address: toText, visible: true }, fetcher),
    tronRequest<Resources>(endpoint, '/wallet/getaccountresource', { address: from, visible: true }, fetcher),
    tronRequest<ChainParameters>(endpoint, '/wallet/getchainparameters', {}, fetcher),
  ])
  const head = block.block_header?.raw_data
  if (!block.blockID || !/^[a-f\d]{64}$/i.test(block.blockID) || !head?.number || !head.timestamp) throw new Error('The Tron provider could not prepare this transfer.')
  const parameter = (key: string) => {
    const found = parameters.chainParameter?.find((entry) => entry.key === key)?.value
    if (typeof found !== 'number' || found < 0) throw new Error('Tron network fees are currently unavailable.')
    return BigInt(found)
  }
  const bandwidthPrice = parameter('getTransactionFee')
  const energyPrice = parameter('getEnergyFee')
  const height = new Uint8Array(8)
  new DataView(height.buffer).setBigUint64(0, BigInt(head.number))
  const refBytes = height.slice(6, 8)
  const refHash = hex.decode(block.blockID).slice(8, 16)
  const timestamp = Date.now()
  const expiration = head.timestamp + 5 * 60_000
  const exists = Boolean(target.address)

  let body: number[]
  let feeLimit: bigint | undefined
  let energyFee = 0n
  if (token) {
    const data = hex.decode('a9059cbb' + word(to.subarray(1)) + value.toString(16).padStart(64, '0'))
    const [held, test] = await Promise.all([
      tronTokenBalances(endpoint, from, [token], fetcher).then((result) => result[token.id]),
      transferTest(endpoint, from, token.contract, hex.encode(data.subarray(4)), fetcher),
    ])
    if (held < value) throw new Error(`Insufficient ${token.symbol} to cover this transfer.`)
    const energy = BigInt(test.energy_used ?? 0)
    if (energy <= 0n) throw new Error('Tron network fees are currently unavailable.')
    const spare = BigInt(Math.max(0, (resources.EnergyLimit ?? 0) - (resources.EnergyUsed ?? 0)))
    energyFee = energy > spare ? (energy - spare) * energyPrice : 0n
    // The cap covers some swing in energy use, unused fee is never charged.
    const cap = energy * energyPrice * 3n / 2n
    feeLimit = cap < 10n * sun ? 10n * sun : cap > 300n * sun ? 300n * sun : cap
    body = triggerContract(owner, tronDecode(token.contract), data)
  } else {
    if (value < 1n) throw new Error('Enter an amount greater than zero.')
    body = transferContract(owner, to, value)
  }
  const raw = encodeRaw({ refBytes, refHash, expiration, timestamp, feeLimit, contract: body })
  const size = BigInt(raw.length + 70)
  const freeBandwidth = BigInt(Math.max(0, (resources.freeNetLimit ?? 0) - (resources.freeNetUsed ?? 0)) + Math.max(0, (resources.NetLimit ?? 0) - (resources.NetUsed ?? 0)))
  // A transfer that creates the recipient's account burns bandwidth plus a creation fee.
  const activation = !token && !exists ? parameter('getCreateNewAccountFeeInSystemContract') + parameter('getCreateAccountFee') : 0n
  const bandwidthFee = activation ? 0n : freeBandwidth >= size ? 0n : size * bandwidthPrice
  const fee = bandwidthFee + energyFee + activation
  if (balance < (token ? 0n : value) + fee) throw new Error(`Insufficient TRX to cover the ${token ? '' : 'amount and '}network fee.`)
  const expires = Date.now() + 45_000
  const hash = hex.encode(sha256(raw))
  return {
    to: toText, value: formatAmount(value, decimals), fee: formatAmount(fee, 6), network, expires, asset: token?.id,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await tronKey(session.mnemonic, session.account)
      try {
        if (tronEncode(tronAddressBytes(key.publicKey!)) !== from) throw new Error('This quote belongs to a different wallet.')
        const signature = secp256k1.Signature.fromBytes(secp256k1.sign(sha256(raw), key.privateKey!, { prehash: false, format: 'recovered' }), 'recovered')
        const signed = Uint8Array.from([...signature.toBytes('compact'), 27 + signature.recovery!])
        const transaction = hex.encode(Uint8Array.from([...bytesField(1, raw), ...bytesField(2, signed)]))
        return { hash, async broadcast() {
          const reply = await tronRequest<{ result?: boolean; txid?: string; code?: string }>(endpoint, '/wallet/broadcasthex', { transaction }, fetcher)
          if (reply.result !== true || String(reply.txid).toLowerCase() !== hash) throw new Error('Tron submission is unverified.')
        } }
      } finally {
        key.wipePrivateData()
      }
    },
  }
}

export async function tronStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!hashPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  const info = await tronRequest<{ blockNumber?: number; result?: string; receipt?: { result?: string } }>(endpoint, '/wallet/gettransactioninfobyid', { value: item.hash }, fetcher)
  if (!info.blockNumber) return item.status
  if (info.result === 'FAILED' || (info.receipt?.result && info.receipt.result !== 'SUCCESS')) return 'failed'
  return 'confirmed'
}

/** Name, symbol and decimals of a TRC-20 contract, for imports. */
export async function tronTokenInfo(endpoint: string, contract: string, fetcher: typeof fetch) {
  const { decodeAbiParameters, hexToString } = await import('viem')
  const read = async (selector: string) => {
    const reply = await tronRequest<{ result?: { result?: boolean }; constant_result?: string[] }>(endpoint, '/wallet/triggerconstantcontract', {
      owner_address: contract, contract_address: contract, function_selector: selector, parameter: '', visible: true,
    }, fetcher)
    const result = reply.constant_result?.[0]
    if (!reply.result?.result || !result || !/^[a-f\d]+$/i.test(result)) return undefined
    return `0x${result}` as const
  }
  const text = async (selector: string) => {
    const result = await read(selector).catch(() => undefined)
    if (!result || result === '0x') return ''
    try {
      if (result.length === 66) return hexToString(result, { size: 32 }).replace(/\0+$/, '')
      return decodeAbiParameters([{ type: 'string' }], result)[0]
    } catch { return '' }
  }
  const [decimals, symbol, name] = await Promise.all([read('decimals()').catch(() => undefined), text('symbol()'), text('name()')])
  return { decimals: decimals && decimals.length === 66 ? Number(BigInt(decimals)) : undefined, symbol, name }
}
