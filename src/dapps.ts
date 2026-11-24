import { getAddress, hexToString, isAddress, isHex, maxUint256, type Hex } from 'viem'
import { base58, base64 } from '@scure/base'
import { getBase64EncodedWireTransaction, getTransactionDecoder, partiallySignTransaction, signBytes, type Transaction } from '@solana/kit'
import { formatAmount, networks } from './networks'
import { tokens } from './tokens'
import { evmAccount, solanaKeypair, type Session } from './vault'
import { privateFetch } from './rpc'

type Params = unknown

/** personal_sign carries hex; show it as text when it is text. */
export function readableMessage(value: string) {
  if (!isHex(value)) return value
  try {
    const text = hexToString(value)
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000e-\u001f�]/.test(text)) return text
  } catch { /* Fall back to hex. */ }
  return value
}

export function personalParams(params: Params) {
  const [first, second] = params as [string, string]
  // Some apps swap the order.
  return isAddress(first) && !isAddress(second) ? { message: second, address: first } : { message: first, address: second }
}

export type TypedData = { domain?: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }
export function typedParams(params: Params) {
  const [address, raw] = params as [string, string | TypedData]
  const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TypedData
  if (!data?.types || !data.primaryType || !data.message) throw new Error('The app sent unreadable signing data.')
  return { address, data }
}

/** Permits let someone move tokens later without another transaction, call them out. */
export function isPermit(data: TypedData) {
  return /permit/i.test(data.primaryType) || Object.keys(data.types).some((name) => /permit/i.test(name))
}

export async function signPersonal(session: Session, params: Params) {
  const { message } = personalParams(params)
  const account = evmAccount(session.mnemonic, session.account)
  return account.signMessage({ message: isHex(message) ? { raw: message } : message })
}

export async function signTyped(session: Session, params: Params) {
  const { data } = typedParams(params)
  const types = { ...data.types }
  delete types.EIP712Domain
  const domain = { ...data.domain }
  if (typeof domain.chainId === 'string') domain.chainId = Number(domain.chainId)
  const account = evmAccount(session.mnemonic, session.account)
  return account.signTypedData({ domain, types, primaryType: data.primaryType, message: data.message } as never)
}

export type EvmCall = { from: string; to?: string; value?: string; data?: Hex }
export function callParams(params: Params) {
  const [call] = params as [EvmCall]
  if (!call || typeof call !== 'object') throw new Error('The app sent an unreadable transaction.')
  return call
}

/** What a contract call does, for the common token calls. */
export function describeCall(call: EvmCall, chainId: number) {
  const data = call.data && call.data !== '0x' ? call.data.toLowerCase() : ''
  if (!data || !call.to) return undefined
  const token = tokens.find((entry) => networks[entry.network]?.chainId === chainId && entry.contract.toLowerCase() === call.to!.toLowerCase())
  const word = (index: number) => data.slice(10 + index * 64, 10 + (index + 1) * 64)
  const amount = (hex: string) => {
    const value = BigInt('0x' + (hex || '0'))
    if (value >= maxUint256 / 2n) return 'Unlimited'
    return token ? `${formatAmount(value, token.decimals)} ${token.symbol}` : value.toString()
  }
  const address = (hex: string) => getAddress('0x' + hex.slice(24))
  try {
    if (data.startsWith('0x095ea7b3')) return { kind: 'approve' as const, label: 'Token permission', spender: address(word(0)), amount: amount(word(1)), token: token?.symbol }
    if (data.startsWith('0xa22cb465')) return { kind: 'approve' as const, label: 'Collection permission', spender: address(word(0)), amount: BigInt('0x' + word(1)) ? 'All items' : 'Removed', token: undefined }
    if (data.startsWith('0xa9059cbb')) return { kind: 'transfer' as const, label: 'Token transfer', to: address(word(0)), amount: amount(word(1)), token: token?.symbol }
  } catch { /* Unknown layout. */ }
  return { kind: 'call' as const, label: 'Contract call', selector: data.slice(0, 10) }
}

// Solana

function decodeTransaction(value: string) {
  return getTransactionDecoder().decode(base64.decode(value)) as Transaction
}

async function solanaRpc<T>(endpoint: string, method: string, params: unknown[], signal: AbortSignal) {
  const response = await privateFetch(signal)(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (!response.ok) throw new Error('The Solana RPC returned an unsuccessful response.')
  const reply = await response.json() as { result?: T; error?: { message?: string } }
  if (reply.error) throw new Error(reply.error.message ?? 'The Solana RPC rejected the request.')
  return reply.result as T
}

/** Test-run a Solana transaction to show how much SOL leaves the wallet. */
export async function previewSolana(owner: string, endpoint: string, transaction: string, signal: AbortSignal) {
  const [balance, simulation] = await Promise.all([
    solanaRpc<{ value: number }>(endpoint, 'getBalance', [owner, { commitment: 'confirmed' }], signal),
    solanaRpc<{ value: { err: unknown; accounts?: ({ lamports: number } | null)[] } }>(endpoint, 'simulateTransaction', [transaction, {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [owner] },
    }], signal),
  ])
  const after = simulation.value.accounts?.[0]?.lamports
  return {
    fails: Boolean(simulation.value.err),
    change: after === undefined ? undefined : BigInt(after) - BigInt(balance.value),
  }
}

export function formatLamports(value: bigint) {
  const sign = value < 0n ? '−' : value > 0n ? '+' : ''
  return `${sign}${formatAmount(value < 0n ? -value : value, 9)} SOL`
}

export function solanaMessage(params: Params) {
  const { message } = params as { message: string }
  const bytes = base58.decode(message)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // eslint-disable-next-line no-control-regex
  return { bytes, text: /[\u0000-\u0008\u000e-\u001f�]/.test(text) ? message : text }
}

export async function signSolanaMessage(session: Session, params: Params) {
  const signer = await solanaKeypair(session.mnemonic, session.account)
  return { signature: base58.encode(await signBytes(signer.keyPair.privateKey, solanaMessage(params).bytes)) }
}

async function signOne(session: Session, value: string) {
  const signer = await solanaKeypair(session.mnemonic, session.account)
  const transaction = decodeTransaction(value)
  if (!(signer.address in transaction.signatures)) throw new Error('This transaction isn’t for this wallet.')
  const signed = await partiallySignTransaction([signer.keyPair], transaction)
  return { signature: base58.encode(signed.signatures[signer.address]!), transaction: getBase64EncodedWireTransaction(signed) as string }
}

export function solanaTransactions(method: string, params: Params): string[] {
  const value = params as { transaction?: string; transactions?: string[] }
  const list = method === 'solana_signAllTransactions' ? value.transactions ?? [] : [value.transaction ?? '']
  if (!list.length || list.some((entry) => typeof entry !== 'string' || !entry)) throw new Error('The app sent an unreadable transaction.')
  return list
}

export async function signSolana(session: Session, method: string, params: Params, endpoint: string, signal: AbortSignal) {
  const list = solanaTransactions(method, params)
  if (method === 'solana_signAllTransactions') return { transactions: (await Promise.all(list.map((entry) => signOne(session, entry)))).map((entry) => entry.transaction) }
  const signed = await signOne(session, list[0])
  if (method === 'solana_signTransaction') return signed
  const sent = await solanaRpc<string>(endpoint, 'sendTransaction', [signed.transaction, { encoding: 'base64', preflightCommitment: 'confirmed' }], signal)
  return { signature: sent }
}
