import { decodeAbiParameters, erc20Abi, getAddress, hexToString, type Hex } from 'viem'
import { addressFor, tokenExplorers, type Addresses, type Network, type NetworkId } from './networks'
import { evmClient, privateFetch, type Prices } from './rpc'
import { cleanLabel, knownToken, looksLikeSpam, type Token, type UserToken } from './tokens'

const splToken = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const token2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const solanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

type PriceRow = Record<string, number | undefined>

/** Prices by contract for imported tokens. Unknown to CoinGecko = no entry. */
async function contractPrices(network: NetworkId, contracts: string[], currency: string, signal: AbortSignal) {
  const result: Record<string, PriceRow> = {}
  const load = async (batch: string[]) => {
    const response = await privateFetch(signal)(`/api/market/token-prices?currency=${encodeURIComponent(currency)}&network=${network}&contracts=${batch.map(encodeURIComponent).join(',')}`)
    if (!response.ok) throw Object.assign(new Error('Token prices are unavailable.'), { status: response.status })
    const data = await response.json() as Record<string, PriceRow | undefined>
    // CoinGecko may change the case of keys, so match case-insensitively.
    for (const [contract, row] of Object.entries(data)) if (row) result[contract.toLowerCase()] = row
  }
  for (let index = 0; index < contracts.length; index += 10) {
    const batch = contracts.slice(index, index + 10)
    try { await load(batch) } catch (error) {
      // Some plans price one contract per call.
      if ((error as { status?: number }).status === 429 || batch.length === 1) throw error
      for (const contract of batch) await load([contract]).catch(() => {})
    }
  }
  return result
}

/** Spot prices and 24h change for imported tokens, keyed by their priceId. */
export async function userTokenPrices(list: Token[], currency: string, signal: AbortSignal) {
  const prices: Prices = {}
  const changes: Prices = {}
  const byNetwork = new Map<NetworkId, Token[]>()
  for (const token of list) if (token.user) byNetwork.set(token.network, [...byNetwork.get(token.network) ?? [], token])
  await Promise.allSettled([...byNetwork].map(async ([network, tokens]) => {
    const rows = await contractPrices(network, tokens.map((token) => token.contract), currency, signal)
    for (const token of tokens) {
      const row = rows[token.contract.toLowerCase()]
      const price = row?.[currency]
      const change = row?.[`${currency}_24h_change`]
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) prices[token.priceId] = price
      if (typeof change === 'number' && Number.isFinite(change)) changes[token.priceId] = change
    }
  }))
  return { prices, changes }
}

async function verified(network: NetworkId, contracts: string[], signal: AbortSignal) {
  if (!contracts.length) return { has: () => false }
  const rows = await contractPrices(network, contracts, 'usd', signal).catch(() => ({} as Record<string, PriceRow>))
  const listed = new Set(Object.entries(rows).filter(([, row]) => typeof row.usd === 'number').map(([contract]) => contract))
  return { has: (contract: string) => listed.has(contract.toLowerCase()) }
}

async function solanaCall<T>(endpoint: string, method: string, params: unknown, signal: AbortSignal): Promise<T> {
  const response = await privateFetch(signal)(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (!response.ok) throw new Error('The Solana RPC returned an unsuccessful response.')
  const data = await response.json() as { result?: T; error?: unknown }
  if (data.error || data.result === undefined) throw new Error('The Solana RPC could not read this token.')
  return data.result
}

type DasAsset = {
  id?: string; interface?: string
  content?: { metadata?: { name?: string; symbol?: string } }
  token_info?: { symbol?: string; balance?: number | string; decimals?: number; token_program?: string; price_info?: { price_per_token?: number } }
}

const decimalsOk = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 36

/** Reads a token's name, symbol and decimals from the chain, and whether CoinGecko lists it. */
export async function lookupToken(network: Network, endpoint: string, input: string, signal: AbortSignal): Promise<UserToken> {
  const text = input.trim()
  if (network.chain === 'solana') {
    if (!solanaAddress.test(text)) throw new Error('Enter a valid Solana token mint address.')
    const info = await solanaCall<{ value: { owner?: string; data?: { parsed?: { type?: string; info?: { decimals?: number } } } } | null }>(endpoint, 'getAccountInfo', [text, { encoding: 'jsonParsed', commitment: 'confirmed' }], signal)
    const account = info.value
    if (!account) throw new Error('No token exists at this address on Solana.')
    if (account.owner === token2022) throw new Error('Token-2022 tokens are not supported yet.')
    if (account.owner !== splToken || account.data?.parsed?.type !== 'mint') throw new Error('This address is not a token mint. Paste the token’s mint address, not a wallet.')
    const decimals = account.data.parsed.info?.decimals
    if (!decimalsOk(decimals)) throw new Error('This token reports invalid decimals.')
    const asset = await solanaCall<DasAsset>(endpoint, 'getAsset', { id: text }, signal).catch(() => undefined)
    const symbol = cleanLabel(asset?.content?.metadata?.symbol || asset?.token_info?.symbol, 12)
    if (!symbol) throw new Error('Still could not read this token’s name. Try again later.')
    const name = cleanLabel(asset?.content?.metadata?.name, 40) || symbol
    return { network: network.id, contract: text, symbol, name, decimals, user: 'custom', verified: (await verified(network.id, [text], signal)).has(text) }
  }
  if (network.chain === 'tron') {
    const { tronDecode } = await import('./keys')
    try { tronDecode(text) } catch { throw new Error('Enter a valid Tron token contract address (starts with T).') }
    const info = await (await import('./tron')).tronTokenInfo(endpoint, text, privateFetch(signal))
    const symbol = cleanLabel(info.symbol, 12)
    if (info.decimals === undefined || !symbol) throw new Error('No TRC-20 token found at this address on Tron.')
    if (!decimalsOk(info.decimals)) throw new Error('This token reports invalid decimals.')
    return { network: network.id, contract: text, symbol, name: cleanLabel(info.name, 40) || symbol, decimals: info.decimals, user: 'custom', verified: (await verified(network.id, [text], signal)).has(text) }
  }
  let contract: `0x${string}`
  try {
    contract = getAddress(text)
    if (text !== text.toLowerCase() && text !== contract) throw new Error('Checksum mismatch.')
  } catch { throw new Error(`Enter a valid ${network.name} token contract address.`) }
  const client = await evmClient(network, endpoint, signal)
  const readText = async (data: Hex) => {
    const { data: result } = await client.call({ to: contract, data })
    if (!result || result === '0x') return ''
    // Old tokens (like MKR) return bytes32 instead of a string.
    if (result.length === 66) return hexToString(result as Hex, { size: 32 }).replace(/\0+$/, '')
    return decodeAbiParameters([{ type: 'string' }], result as Hex)[0]
  }
  const [decimals, symbol, name] = await Promise.all([
    client.readContract({ address: contract, abi: erc20Abi, functionName: 'decimals' }).catch(() => undefined),
    readText('0x95d89b41').catch(() => ''),
    readText('0x06fdde03').catch(() => ''),
  ])
  const cleanSymbol = cleanLabel(symbol, 12)
  if (decimals === undefined || !cleanSymbol) throw new Error(`No token found at this address on ${network.name}. Check the network and address.`)
  if (!decimalsOk(decimals)) throw new Error('This token reports invalid decimals.')
  return { network: network.id, contract, symbol: cleanSymbol, name: cleanLabel(name, 40) || cleanSymbol, decimals, user: 'custom', verified: (await verified(network.id, [contract], signal)).has(contract) }
}

export type Found = { token: UserToken; amount: bigint }

/** balanceOf for many tokens through Multicall3 (same address on every EVM chain Still supports). */
async function readBalances(network: Network, endpoint: string, owner: string, entries: Found[], signal: AbortSignal) {
  const client = await evmClient(network, endpoint, signal)
  const results = await client.multicall({
    multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11', allowFailure: true, batchSize: 12_000,
    contracts: entries.map((entry) => ({ address: entry.token.contract as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [getAddress(owner)] as const })),
  })
  results.forEach((result, index) => { entries[index].amount = result.status === 'success' ? result.result : 0n })
}

/** Tokens this wallet holds that Still doesn't list yet. Spam (unpriced, phishing names) is skipped. */
export async function discoverTokens(network: Network, endpoint: string, addresses: Addresses, signal: AbortSignal): Promise<Found[]> {
  const owner = addressFor(network, addresses)
  type Candidate = Found & { priced: boolean }
  let candidates: Candidate[] = []
  if (network.chain === 'solana') {
    const result = await solanaCall<{ items?: DasAsset[] }>(endpoint, 'searchAssets', { ownerAddress: owner, tokenType: 'fungible', limit: 100, page: 1 }, signal)
    candidates = (result.items ?? []).flatMap((asset): Candidate[] => {
      const info = asset.token_info
      const symbol = cleanLabel(asset.content?.metadata?.symbol || info?.symbol, 12)
      const name = cleanLabel(asset.content?.metadata?.name, 40) || symbol
      if (!asset.id || !solanaAddress.test(asset.id) || info?.token_program !== splToken || !decimalsOk(info.decimals) || !symbol) return []
      let amount: bigint
      try { amount = BigInt(info.balance ?? 0) } catch { return [] }
      if (amount <= 0n) return []
      return [{ token: { network: network.id, contract: asset.id, symbol, name, decimals: info.decimals, user: 'found', verified: false }, amount, priced: typeof info.price_info?.price_per_token === 'number' }]
    })
  } else if (network.chain === 'tron') {
    const response = await privateFetch(signal)(`/api/tokens/${network.id}/${owner}`)
    if (!response.ok) throw new Error('Token discovery is unavailable.')
    const list = await response.json() as { contract?: string; value?: string }[]
    if (!Array.isArray(list)) throw new Error('Token discovery is unavailable.')
    // Tron is full of fake-token airdrops: only look at contracts CoinGecko lists before reading them.
    const held = list.filter((entry) => typeof entry.contract === 'string' && typeof entry.value === 'string' && /^\d+$/.test(entry.value) && !knownToken(network.id, entry.contract)).slice(0, 40)
    const listed = await verified(network.id, held.map((entry) => entry.contract!), signal)
    const { tronTokenInfo } = await import('./tron')
    const found = await Promise.all(held.filter((entry) => listed.has(entry.contract!)).slice(0, 10).map(async (entry): Promise<Found | undefined> => {
      const info = await tronTokenInfo(endpoint, entry.contract!, privateFetch(signal)).catch(() => undefined)
      const symbol = cleanLabel(info?.symbol, 12)
      if (!info || !symbol || !decimalsOk(info.decimals) || looksLikeSpam(info.name, symbol)) return undefined
      return { token: { network: network.id, contract: entry.contract!, symbol, name: cleanLabel(info.name, 40) || symbol, decimals: info.decimals, user: 'found', verified: true }, amount: BigInt(entry.value!) }
    }))
    return found.filter((entry): entry is Found => !!entry && entry.amount > 0n)
  } else if (tokenExplorers[network.id]) {
    const response = await privateFetch(signal)(`/api/tokens/${network.id}/${owner}`)
    if (!response.ok) throw new Error('Token discovery is unavailable.')
    const list = await response.json() as { contract?: string; value?: string; name?: string; symbol?: string; decimals?: number; priced?: boolean; scam?: boolean; curated?: boolean }[]
    if (!Array.isArray(list)) throw new Error('Token discovery is unavailable.')
    candidates = list.flatMap((entry): Candidate[] => {
      const symbol = cleanLabel(entry.symbol, 12)
      if (entry.scam || !symbol || !decimalsOk(entry.decimals) || (entry.value !== undefined && (typeof entry.value !== 'string' || !/^\d+$/.test(entry.value)))) return []
      let contract: string
      try { contract = getAddress(entry.contract ?? '') } catch { return [] }
      return [{ token: { network: network.id, contract, symbol, name: cleanLabel(entry.name, 40) || symbol, decimals: entry.decimals, user: 'found', verified: false }, amount: entry.value === undefined ? -1n : BigInt(entry.value), priced: entry.priced === true || entry.curated === true }]
    })
    // Curated lists (PancakeSwap on BNB Chain) come without balances: read them all in a few multicalls.
    const curated = candidates.filter((entry) => entry.amount < 0n && entry.priced)
    if (curated.length) await readBalances(network, endpoint, owner, curated.slice(0, 800), signal)
  } else return []
  candidates = candidates.filter((entry) => entry.amount !== 0n && !knownToken(network.id, entry.token.contract) && !looksLikeSpam(entry.token.name, entry.token.symbol)).slice(0, 40)
  const listed = await verified(network.id, candidates.map((entry) => entry.token.contract), signal)
  // Transfer-history lists (Routescan) come without balances: read them for listed tokens only.
  const unread = candidates.filter((entry) => entry.amount < 0n && listed.has(entry.token.contract)).slice(0, 40)
  if (unread.length) await readBalances(network, endpoint, owner, unread, signal)
  candidates = candidates.filter((entry) => entry.amount > 0n)
  return candidates.flatMap(({ token, amount, priced }) => {
    const known = listed.has(token.contract)
    // Only tokens with a real market: CoinGecko lists them, or the explorer prices them.
    return known || priced ? [{ token: { ...token, verified: known }, amount }] : []
  })
}
