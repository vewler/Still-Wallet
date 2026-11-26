import { getAddress, hexToString, isAddress, isHex, type Hex } from 'viem'
import { base58, base64 } from '@scure/base'
import { getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getTransactionDecoder, partiallySignTransaction, signBytes, type Transaction } from '@solana/kit'
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

/** Orders and other signatures that hand out spending or selling rights, by their field names. */
const riskyFields = new Set(['spender', 'operator', 'offer', 'consideration', 'allowed', 'sellamount', 'buyamount', 'selltoken', 'maker', 'taker'])
export function grantsRights(data: TypedData) {
  return Object.entries(data.types).some(([name, fields]) => name !== 'EIP712Domain' && Array.isArray(fields) && fields.some((field) => riskyFields.has(String(field?.name).toLowerCase())))
}

/** A signature for another chain than the one the app is connected on could be used there. */
export function checkTypedChain(data: TypedData, chainId?: number) {
  const signed = data.domain?.chainId
  if (signed === undefined || signed === null || chainId === undefined) return
  if (Number(signed) !== chainId) throw new Error('This signature is for a different network than the one the app is connected on.')
}

export async function signPersonal(session: Session, params: Params) {
  const { message } = personalParams(params)
  const account = evmAccount(session.mnemonic, session.account)
  return account.signMessage({ message: isHex(message) ? { raw: message } : message })
}

export async function signTyped(session: Session, params: Params, chainId?: number) {
  const { data } = typedParams(params)
  checkTypedChain(data, chainId)
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

const MAX_UINT160 = (1n << 160n) - 1n

/** What a contract call does, for the common token, permission and item calls. */
export function describeCall(call: EvmCall, chainId: number) {
  const data = call.data && call.data !== '0x' ? call.data.toLowerCase() : ''
  if (!data || !call.to) return undefined
  const known = (contract: string) => tokens.find((entry) => networks[entry.network]?.chainId === chainId && entry.contract.toLowerCase() === contract.toLowerCase())
  const token = known(call.to)
  const selector = data.slice(0, 10)
  const word = (index: number) => {
    const value = data.slice(10 + index * 64, 10 + (index + 1) * 64)
    if (value.length !== 64) throw new Error('short')
    return value
  }
  const number = (hex: string) => BigInt('0x' + hex)
  // Only a known token's second word is an amount, on other contracts it can be an item id.
  const amount = (hex: string, asset = token, max = 2n ** 256n - 1n) => {
    const value = number(hex)
    if (value >= max / 2n) return 'Unlimited'
    return asset ? `${formatAmount(value, asset.decimals)} ${asset.symbol}` : value.toString()
  }
  const address = (hex: string) => getAddress('0x' + hex.slice(24))
  const raw = !token
  try {
    if (selector === '0x095ea7b3' || selector === '0x39509351') return { kind: 'approve' as const, label: 'Token permission', spender: address(word(0)), amount: amount(word(1)), token: token?.symbol, raw, selector }
    if (selector === '0xa22cb465') return { kind: 'approve' as const, label: 'Collection permission', spender: address(word(0)), amount: number(word(1)) ? 'All items' : 'Removed', token: undefined, raw: false, selector }
    // Permit2 approve(token, spender, amount, expiration).
    if (selector === '0x87517c45') {
      const asset = known(address(word(0)))
      return { kind: 'approve' as const, label: 'Token permission', spender: address(word(1)), amount: amount(word(2), asset, MAX_UINT160), token: asset?.symbol, raw: !asset, selector }
    }
    if (selector === '0xa9059cbb') return { kind: 'transfer' as const, label: 'Token transfer', to: address(word(0)), amount: amount(word(1)), token: token?.symbol, raw, selector }
    if (selector === '0x23b872dd') return { kind: 'transfer' as const, label: 'Token transfer', to: address(word(1)), amount: amount(word(2)), token: token?.symbol, raw, selector }
    if (selector === '0x42842e0e' || selector === '0xb88d4fde') return { kind: 'transfer' as const, label: 'Item transfer', to: address(word(1)), amount: `#${number(word(2))}`, token: undefined, raw: false, selector }
    if (selector === '0xf242432a') return { kind: 'transfer' as const, label: 'Item transfer', to: address(word(1)), amount: `${number(word(3))} × #${number(word(2))}`, token: undefined, raw: false, selector }
    if (selector === '0x2eb2c2d6') return { kind: 'transfer' as const, label: 'Item transfer', to: address(word(1)), amount: 'Several items', token: undefined, raw: false, selector }
  } catch { /* Unknown layout. */ }
  // Something other than a plain transfer or approval on a token contract: worth a second look.
  return { kind: 'call' as const, label: 'Contract call', selector, data, onToken: Boolean(token) }
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

const SYSTEM = '11111111111111111111111111111111'
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'])
const KNOWN_PROGRAMS = new Set([SYSTEM, ...TOKEN_PROGRAMS, 'ComputeBudget111111111111111111111111111111', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'])

type Compiled = {
  staticAccounts: string[]
  instructions?: { programAddressIndex: number; data?: Uint8Array }[]
  instructionHeaders?: { programAccountIndex: number }[]
  instructionPayloads?: { instructionData: Uint8Array }[]
}

/** Programs and risky instructions a transaction calls directly. */
function readInstructions(value: string) {
  const { messageBytes } = decodeTransaction(value)
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as Compiled
  const list = message.instructions?.map((entry) => ({ program: message.staticAccounts[entry.programAddressIndex], data: entry.data ?? new Uint8Array() }))
    ?? (message.instructionHeaders ?? []).map((entry, index) => ({ program: message.staticAccounts[entry.programAccountIndex], data: message.instructionPayloads?.[index]?.instructionData ?? new Uint8Array() }))
  let approve = false, authority = false, unknown = 0
  for (const { program, data } of list) {
    if (TOKEN_PROGRAMS.has(program)) {
      // Approve, ApproveChecked, SetAuthority.
      if (data[0] === 4 || data[0] === 13) approve = true
      if (data[0] === 6) authority = true
    } else if (program === SYSTEM) {
      // Assign and AssignWithSeed hand the account to another program.
      const kind = data.length >= 4 ? new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) : -1
      if (kind === 1 || kind === 10) authority = true
    } else if (!KNOWN_PROGRAMS.has(program)) unknown++
  }
  return { approve, authority, unknown, accounts: message.staticAccounts }
}

type TokenState = { mint: string; owner: string; amount: bigint; delegate?: string }
/** SPL token account layout: mint, owner, amount, delegate option. */
function readTokenAccount(data?: [string, string] | string[]): TokenState | undefined {
  const raw = data?.[0] ? base64.decode(data[0]) : undefined
  if (!raw || raw.length < 108) return undefined
  const view = new DataView(raw.buffer, raw.byteOffset, raw.length)
  return {
    mint: base58.encode(raw.slice(0, 32)), owner: base58.encode(raw.slice(32, 64)), amount: view.getBigUint64(64, true),
    delegate: view.getUint32(72, true) === 1 ? base58.encode(raw.slice(76, 108)) : undefined,
  }
}

type RpcAccount = { lamports: number; owner: string; data: [string, string] } | null
type SolanaPreview = { fails: boolean; failed: boolean; change?: bigint; tokens: { mint: string; symbol?: string; decimals?: number; change: bigint }[]; approve: boolean; authority: boolean; unknown: number }

/** Test-run Solana transactions and show what leaves the wallet: SOL, tokens, and permissions handed out. */
export async function previewSolana(owner: string, endpoint: string, transactions: string[], signal: AbortSignal): Promise<SolanaPreview> {
  const read = transactions.map(readInstructions)
  const result: SolanaPreview = {
    fails: false, failed: false, tokens: [], unknown: read.reduce((sum, entry) => sum + entry.unknown, 0),
    approve: read.some((entry) => entry.approve), authority: read.some((entry) => entry.authority),
  }
  const [balance, ...owned] = await Promise.all([
    solanaRpc<{ value: number }>(endpoint, 'getBalance', [owner, { commitment: 'confirmed' }], signal),
    ...[...TOKEN_PROGRAMS].map((programId) => solanaRpc<{ value: { pubkey: string; account: NonNullable<RpcAccount> }[] }>(endpoint, 'getTokenAccountsByOwner', [owner, { programId }, { encoding: 'base64', commitment: 'confirmed' }], signal)),
  ])
  // Accounts the transactions name first, the simulation only returns up to 100.
  const named = new Set(read.flatMap((entry) => entry.accounts))
  const accounts = owned.flatMap((list) => list.value).map((entry) => ({ address: entry.pubkey, before: readTokenAccount(entry.account.data) }))
    .filter((entry): entry is { address: string; before: TokenState } => Boolean(entry.before))
    .sort((a, b) => Number(named.has(b.address)) - Number(named.has(a.address))).slice(0, 60)
  const changes = new Map<string, bigint>()
  let change = 0n
  for (const transaction of transactions) {
    const simulation = await solanaRpc<{ value: { err: unknown; accounts?: RpcAccount[] } }>(endpoint, 'simulateTransaction', [transaction, {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: [owner, ...accounts.map((entry) => entry.address)] },
    }], signal)
    if (simulation.value.err) result.fails = true
    const [wallet, ...after] = simulation.value.accounts ?? []
    if (!wallet) { result.failed = true; continue }
    change += BigInt(wallet.lamports) - BigInt(balance.value)
    // The wallet itself moved to another program.
    if (wallet.owner && wallet.owner !== SYSTEM) result.authority = true
    accounts.forEach((entry, index) => {
      const state = after[index] ? readTokenAccount(after[index]!.data) : undefined
      const amount = state?.amount ?? 0n
      if (amount !== entry.before.amount) changes.set(entry.before.mint, (changes.get(entry.before.mint) ?? 0n) + amount - entry.before.amount)
      if (state && state.owner !== entry.before.owner) result.authority = true
      if (state?.delegate && state.delegate !== entry.before.delegate) result.approve = true
    })
  }
  if (!result.failed) result.change = change
  // Symbols for known tokens, decimals from the chain for the rest.
  const mints = [...changes.keys()]
  const unknownMints = mints.filter((mint) => !tokens.some((token) => token.network === 'solana-main' && token.contract === mint)).slice(0, 16)
  const decimals = new Map<string, number>()
  if (unknownMints.length) {
    const info = await solanaRpc<{ value: RpcAccount[] }>(endpoint, 'getMultipleAccounts', [unknownMints, { encoding: 'base64', commitment: 'confirmed' }], signal).catch(() => undefined)
    info?.value.forEach((account, index) => {
      const raw = account?.data?.[0] ? base64.decode(account.data[0]) : undefined
      if (raw && raw.length > 44) decimals.set(unknownMints[index], raw[44])
    })
  }
  result.tokens = mints.map((mint) => {
    const token = tokens.find((entry) => entry.network === 'solana-main' && entry.contract === mint)
    return { mint, symbol: token?.symbol, decimals: token?.decimals ?? decimals.get(mint), change: changes.get(mint)! }
  }).filter((entry) => entry.change !== 0n)
  return result
}

export function formatTokenChange(entry: SolanaPreview['tokens'][number]) {
  const value = entry.change < 0n ? -entry.change : entry.change
  const sign = entry.change < 0n ? '−' : '+'
  const name = entry.symbol ?? `${entry.mint.slice(0, 4)}…${entry.mint.slice(-4)}`
  return `${sign}${entry.decimals === undefined ? value.toString() : formatAmount(value, entry.decimals)} ${name}`
}

export function formatLamports(value: bigint) {
  const sign = value < 0n ? '−' : value > 0n ? '+' : ''
  return `${sign}${formatAmount(value < 0n ? -value : value, 9)} SOL`
}

const offchainPrefix = new Uint8Array([0xff, ...new TextEncoder().encode('solana offchain')])

/**
 * Only plain text (or Solana off-chain messages) is signed. Anything else could be a
 * transaction message, and a signature over that is a valid transaction signature.
 */
export function solanaMessage(params: Params) {
  const { message } = (params ?? {}) as { message?: unknown }
  if (typeof message !== 'string' || !message) throw new Error('The app sent an unreadable message.')
  let bytes: Uint8Array
  try { bytes = base58.decode(message) } catch { throw new Error('The app sent an unreadable message.') }
  if (offchainPrefix.every((byte, index) => bytes[index] === byte)) return { bytes, text: message }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = '' }
  // eslint-disable-next-line no-control-regex
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new Error('This message isn’t readable text, so Still won’t sign it. It could be a hidden transaction.')
  return { bytes, text }
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
