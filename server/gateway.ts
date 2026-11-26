import type { IncomingMessage, ServerResponse } from 'node:http'
import { networks, tokenExplorers, utxoChains, type NetworkId } from '../src/networks.ts'
import { dogecoinRoute } from './dogecoin.ts'
import { blockchairRoute, insightRoute, kaspaPath } from './utxoProviders.ts'
import { Readable } from 'node:stream'
import { createMarket } from './market.ts'
import { isMoneroPath, moneroProxy } from './monero.ts'
import { allowCustomRpc, customRpcChains, restChains, restRoute } from './layer1.ts'

const evmMethods = new Set([
  'eth_chainId', 'eth_getBalance', 'eth_call', 'eth_estimateGas', 'eth_getBlockByNumber',
  'eth_maxPriorityFeePerGas', 'eth_gasPrice', 'eth_feeHistory', 'eth_getTransactionCount',
  'eth_sendRawTransaction', 'eth_getTransactionReceipt',
])
const solanaMethods = new Set([
  'getGenesisHash', 'getBalance', 'getMultipleAccounts', 'getAccountInfo', 'getTokenAccountBalance',
  'getLatestBlockhash', 'getFeeForMessage', 'getMinimumBalanceForRentExemption', 'getSignatureStatuses',
  'getBlockHeight', 'sendTransaction', 'simulateTransaction', 'getAsset', 'searchAssets', 'getTokenAccountsByOwner',
])
// Helius DAS methods take named params.
const objectParams = new Set(['getAsset', 'searchAssets'])
// Operations the Sui SDK sends (its generated GraphQL documents), nothing hand-written.
const suiQueries = new Set([
  'checkpointTransactions', 'defaultSuinsName', 'getAllBalances', 'getBalance', 'getChainIdentifier', 'getCoinMetadata', 'getCoins', 'getCurrentSystemState',
  'getDynamicFields', 'getMoveFunction', 'getOwnedObjects', 'getProtocolConfig', 'getReferenceGasPrice', 'getTransactionBlock', 'getTransactionEvents',
  'getTransactionObjectChanges', 'ledgerStreamState', 'listCheckpoints', 'listEvents', 'listTransactions', 'multiGetObjects', 'resolveNameServiceAddress',
  'resolveTransaction', 'scanCheckpoints', 'scanCheckpointsWithTransactions', 'scanEvents', 'scanTransactions', 'simulateTransaction', 'verifySignature',
])
const xrpMethods = new Set(['server_info', 'account_info', 'fee', 'submit', 'tx'])
const tronPaths = new Set([
  '/wallet/getblockbynum', '/wallet/getnowblock', '/wallet/getaccount', '/wallet/getaccountresource', '/wallet/getchainparameters',
  '/wallet/triggerconstantcontract', '/wallet/broadcasthex', '/wallet/gettransactioninfobyid',
])
const aptosGet = /^(?:|\/accounts\/0x[a-f\d]{64}(?:\/balance\/0x1::aptos_coin::AptosCoin)?|\/estimate_gas_price|\/transactions\/by_hash\/0x[a-f\d]{64})$/
const aptosPost = new Set(['/transactions', '/transactions/simulate'])
// Public providers rate-limit shared Cloudflare IPs, so busy chains get a second provider.
const backups: Partial<Record<string, string[]>> = {
  solana: ['https://api.mainnet-beta.solana.com'],
  ethereum: ['https://eth.drpc.org'],
}
const hex = /^[a-f\d]+$/i
const bitcoinGet = /^\/(?:block-height\/0|blocks\/tip\/height|fee-estimates|v1\/fees\/recommended|address\/[A-Za-z\d]{25,90}(?:\/utxo)?|tx\/[a-f\d]{64}\/(?:hex|status))$/
const requestLimit = 128 * 1024
const responseLimit = 8 * 1024 * 1024 + 1024

class GatewayError extends Error {
  readonly status: number
  constructor(status: number) {
    super()
    this.status = status
  }
}

async function readBody(request: IncomingMessage, limit = requestLimit) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length
    if (length > limit) {
      request.resume()
      throw new GatewayError(413)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function allowRpc(methods: Set<string>, body: string) {
  let payload
  try { payload = JSON.parse(body) } catch { throw new GatewayError(400) }
  if (!payload || Array.isArray(payload) || !methods.has(payload.method)) throw new GatewayError(400)
  if (objectParams.has(payload.method)) {
    const params = payload.params
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new GatewayError(400)
    if (payload.method === 'searchAssets' && (params.tokenType !== 'fungible' || typeof params.ownerAddress !== 'string' || Number(params.limit) > 100)) throw new GatewayError(400)
    if (payload.method === 'getAsset' && typeof params.id !== 'string') throw new GatewayError(400)
  } else if (payload.params !== undefined && !Array.isArray(payload.params)) throw new GatewayError(400)
  if (payload.method === 'submit') {
    const [params] = payload.params ?? []
    if (payload.params?.length !== 1 || !params || typeof params.tx_blob !== 'string' || !hex.test(params.tx_blob) ||
      Object.keys(params).some((key) => key !== 'tx_blob' && key !== 'fail_hard')) throw new GatewayError(400)
  }
  if (payload.method === 'getTokenAccountsByOwner' && !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(payload.params?.[1]?.programId)) throw new GatewayError(400)
  if (payload.method === 'eth_getBlockByNumber' && payload.params?.[1] !== false) throw new GatewayError(400)
  if (payload.method === 'getMultipleAccounts' && (!Array.isArray(payload.params?.[0]) || payload.params[0].length > 16)) {
    throw new GatewayError(400)
  }
  return payload as { id?: unknown; method: string }
}

export function createGateway(env = process.env, fetchUpstream = fetch) {
  const market = createMarket(env, fetchUpstream)
  const endpoints = new Map(Object.values(networks).map((network) => {
    const list = [env[`STILL_RPC_${network.chain.toUpperCase()}`] || network.rpc, ...(backups[network.chain] ?? [])].map((value) => {
      let endpoint: URL | undefined
      try { endpoint = new URL(value) } catch { /* Keep malformed provider URLs out of startup logs. */ }
      if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
        throw new Error(`Invalid server RPC URL for ${network.name}. Use an HTTPS URL.`)
      }
      return endpoint
    })
    return [network.id, list]
  }))
  let active = 0
  // Per-client limit so the gateway can't be used as a free RPC/price proxy. One balance refresh is ~250 calls (every network and token), so leave room for a few.
  const perMinute = Math.max(1, Number(env.STILL_RATE_LIMIT) || 1200)
  const trustProxy = env.STILL_TRUST_PROXY === '1'
  const clients = new Map<string, { count: number; reset: number }>()
  const overBudget = (request: IncomingMessage) => {
    const forwarded = trustProxy ? String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : ''
    const client = forwarded || request.socket.remoteAddress || 'unknown'
    const now = Date.now()
    if (clients.size > 10_000) for (const [key, entry] of clients) if (entry.reset <= now) clients.delete(key)
    const entry = clients.get(client)
    if (!entry || entry.reset <= now) { clients.set(client, { count: 1, reset: now + 60_000 }); return false }
    return ++entry.count > perMinute
  }

  // Cross-chain swaps go through NEAR Intents (1Click). Proxied so the provider never sees the user's IP.
  const swapRoutes: Record<string, [method: string, upstream: string]> = {
    '/api/swap/tokens': ['GET', 'tokens'], '/api/swap/quote': ['POST', 'quote'], '/api/swap/submit': ['POST', 'deposit/submit'],
  }
  const text = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200
  const one = (...allowed: unknown[]) => (value: unknown) => allowed.includes(value)
  const swapFields: Record<string, Record<string, (value: unknown) => boolean>> = {
    '/api/swap/quote': {
      dry: one(false), swapType: one('EXACT_INPUT'), slippageTolerance: (value) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 5000,
      originAsset: text, depositType: one('ORIGIN_CHAIN'), depositMode: one('MEMO'), destinationAsset: text, amount: (value) => typeof value === 'string' && /^\d{1,60}$/.test(value),
      refundTo: text, refundType: one('ORIGIN_CHAIN'), recipient: text, recipientType: one('DESTINATION_CHAIN'), deadline: (value) => text(value) && !Number.isNaN(Date.parse(value as string)),
    },
    '/api/swap/submit': { txHash: text, depositAddress: text },
  }
  const swapProxy = async (path: string, request: IncomingMessage, response: ServerResponse, fail: (status: number) => void) => {
    const route = Object.hasOwn(swapRoutes, path) ? swapRoutes[path] : undefined
    if (!route) return fail(404)
    if (route[0] !== request.method) return fail(405)
    try {
      let body: string | undefined
      if (request.method === 'POST') {
        body = (await readBody(request, 16 * 1024)).toString('utf8')
        const payload = JSON.parse(body)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GatewayError(400)
        // Only the fields Still sends, so the key can't be used for anything else.
        const fields = swapFields[path]
        if (Object.entries(payload).some(([key, value]) => !Object.hasOwn(fields, key) || !fields[key](value))) throw new GatewayError(400)
        if (path === '/api/swap/quote' && ['originAsset', 'destinationAsset', 'amount', 'refundTo', 'recipient'].some((key) => !(key in payload))) throw new GatewayError(400)
        body = JSON.stringify(payload)
      }
      const token = env.STILL_ONECLICK_JWT
      const upstream = await fetchUpstream(`https://1click.chaindefuser.com/v0/${route[1]}`, {
        method: request.method, body, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      const text = await upstream.text()
      if (text.length > responseLimit) throw new GatewayError(502)
      if (upstream.status >= 500 || upstream.status === 429) return fail(upstream.status === 429 ? 429 : 502)
      response.statusCode = upstream.status
      response.end(text)
    } catch (error) {
      if (!response.destroyed) fail(error instanceof GatewayError ? error.status : error instanceof SyntaxError ? 400 : 502)
    }
  }

  // Tokens an EVM address holds, from Blockscout. Proxied so the explorer never sees the user's IP; trimmed to what discovery needs.
  // Curated token lists (Uniswap's, plus PancakeSwap's on BNB Chain): spam-free, the app reads balances on chain.
  type Listed = { contract: string; name: string; symbol: string; decimals: number; curated: true }
  const lists = new Map<string, { tokens: { chainId: number; token: Listed }[]; expires: number }>()
  const loadList = async (url: string) => {
    const cached = lists.get(url)
    if (cached && cached.expires > Date.now()) return cached.tokens
    const upstream = await fetchUpstream(url, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json', 'User-Agent': 'StillWallet/0.1' } })
    if (!upstream.ok) { await upstream.body?.cancel(); throw new GatewayError(502) }
    const text = await upstream.text()
    if (text.length > responseLimit) throw new GatewayError(502)
    const data = JSON.parse(text) as { tokens?: { chainId?: number; address?: string; name?: string; symbol?: string; decimals?: number }[] }
    const tokens = (data.tokens ?? []).flatMap((token) => typeof token.chainId === 'number' && typeof token.address === 'string' && /^0x[\da-fA-F]{40}$/.test(token.address)
      ? [{ chainId: token.chainId, token: { contract: token.address, name: String(token.name ?? '').slice(0, 80), symbol: String(token.symbol ?? '').slice(0, 30), decimals: Number(token.decimals), curated: true as const } }] : [])
    lists.set(url, { tokens, expires: Date.now() + 6 * 60 * 60_000 })
    return tokens
  }
  const curated = async (network: NetworkId) => {
    const chainId = networks[network].chainId
    const sources = ['https://tokens.uniswap.org', ...network === 'bnb-main' ? ['https://tokens.pancakeswap.finance/pancakeswap-extended.json'] : []]
    const loaded = await Promise.allSettled(sources.map(loadList))
    const seen = new Map<string, Listed>()
    for (const result of loaded) if (result.status === 'fulfilled') for (const entry of result.value) if (entry.chainId === chainId && !seen.has(entry.token.contract.toLowerCase())) seen.set(entry.token.contract.toLowerCase(), entry.token)
    if (!seen.size && loaded.every((result) => result.status === 'rejected')) throw new GatewayError(502)
    return JSON.stringify([...seen.values()].slice(0, 800))
  }
  const tokenList = async (path: string, request: IncomingMessage, response: ServerResponse, fail: (status: number) => void) => {
    const match = /^\/api\/tokens\/([a-z]+-main)\/(0x[\da-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})$/.exec(path)
    const host = match && Object.hasOwn(tokenExplorers, match[1]) ? tokenExplorers[match[1] as NetworkId] : undefined
    if (!match || !host || (match[1] === 'tron-main') !== match[2].startsWith('T')) return fail(404)
    if (request.method !== 'GET') return fail(405)
    try {
      if (match[1] === 'tron-main') {
        // TronGrid: TRC-20 balances only, metadata is read from the chain by the app.
        const upstream = await fetchUpstream(`https://${host}/v1/accounts/${match[2]}?only_confirmed=true`, {
          redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json', 'User-Agent': 'StillWallet/0.1' },
        })
        if (!upstream.ok) { await upstream.body?.cancel(); return fail(upstream.status === 429 ? 429 : 502) }
        const text = await upstream.text()
        if (text.length > responseLimit) throw new GatewayError(502)
        const data = JSON.parse(text) as { data?: { trc20?: Record<string, unknown>[] }[] }
        const tokens = (data.data?.[0]?.trc20 ?? []).flatMap((entry) => Object.entries(entry ?? {}))
          .filter(([contract, value]) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(contract) && typeof value === 'string' && /^\d+$/.test(value) && value !== '0')
          .map(([contract, value]) => ({ contract, value })).slice(0, 300)
        return void response.end(JSON.stringify(tokens))
      }
      if (host === 'tokens.pancakeswap.finance') return void response.end(await curated(match[1] as NetworkId))
      if (host.startsWith('api.routescan.io/')) {
        // Routescan has no free balance list: return tokens the address ever received, the app checks balances on chain.
        const upstream = await fetchUpstream(`https://${host}/etherscan/api?module=account&action=tokentx&address=${match[2]}&page=1&offset=500&sort=desc`, {
          redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json', 'User-Agent': 'StillWallet/0.1' },
        })
        if (!upstream.ok) { await upstream.body?.cancel(); return void response.end(await curated(match[1] as NetworkId)) }
        const text = await upstream.text()
        if (text.length > responseLimit) throw new GatewayError(502)
        const data = JSON.parse(text) as { result?: unknown }
        const seen = new Map<string, { contract: string; name: string; symbol: string; decimals: number; priced: boolean; scam: boolean }>()
        for (const entry of Array.isArray(data.result) ? data.result : []) {
          const contract = entry?.contractAddress
          if (typeof contract !== 'string' || !/^0x[\da-fA-F]{40}$/.test(contract) || seen.has(contract.toLowerCase())) continue
          seen.set(contract.toLowerCase(), { contract, name: String(entry.tokenName ?? '').slice(0, 80), symbol: String(entry.tokenSymbol ?? '').slice(0, 30), decimals: Number(entry.tokenDecimal), priced: false, scam: false })
        }
        return void response.end(JSON.stringify([...seen.values()].slice(0, 300)))
      }
      // Blockscout rate-limits shared Cloudflare IPs, wait a moment and try again.
      let upstream: Response | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((done) => setTimeout(done, 1200 * attempt))
        upstream = await fetchUpstream(`https://${host}/api/v2/addresses/${match[2]}/token-balances`, {
          redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json', 'User-Agent': 'StillWallet/0.1' },
        })
        if (upstream.status !== 429) break
        await upstream.body?.cancel()
      }
      if (!upstream!.ok) {
        await upstream!.body?.cancel()
        // No activity yet: Blockscout answers 404.
        if (upstream!.status === 404) return void response.end('[]')
        // Blocked or rate-limited: fall back to the curated list.
        return void response.end(await curated(match[1] as NetworkId))
      }
      const text = await upstream!.text()
      if (text.length > responseLimit) throw new GatewayError(502)
      const list = JSON.parse(text) as unknown
      if (!Array.isArray(list)) throw new GatewayError(502)
      const tokens = list.flatMap((entry) => {
        const token = entry?.token
        const contract = token?.address_hash ?? token?.address
        if (token?.type !== 'ERC-20' || typeof contract !== 'string' || typeof entry.value !== 'string' || !/^\d+$/.test(entry.value) || entry.value === '0') return []
        return [{
          contract, value: entry.value, name: String(token.name ?? '').slice(0, 80), symbol: String(token.symbol ?? '').slice(0, 30),
          decimals: Number(token.decimals), priced: token.exchange_rate != null, scam: token.reputation === 'scam' || token.is_scam === true,
        }]
      }).slice(0, 300)
      response.end(JSON.stringify(tokens))
    } catch (error) {
      if (!response.destroyed) fail(error instanceof GatewayError ? error.status : 502)
    }
  }

  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url ?? ''
    const monero = isMoneroPath(path)
    if (!path.startsWith('/api/') && !monero) return next()
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    const fail = (status: number) => {
      response.statusCode = status
      response.end(JSON.stringify({ error: status >= 500 ? 'Chain provider unavailable' : 'RPC request rejected' }))
    }
    if (path === '/api/health' && request.method === 'GET') return response.end('{"ok":true}')
    const origin = request.headers.origin
    if (request.headers['sec-fetch-site'] === 'cross-site' ||
      (origin && !['http://' + request.headers.host, 'https://' + request.headers.host].includes(origin))) return fail(403)
    if (overBudget(request)) {
      response.setHeader('Retry-After', '60')
      return fail(429)
    }
    if (monero) {
      const host = request.headers.host ?? 'localhost'
      const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
      let body: Uint8Array<ArrayBuffer> | undefined
      try { body = request.method === 'POST' ? new Uint8Array(await readBody(request, 1024 * 1024)) : undefined } catch { return fail(413) }
      const reply = await moneroProxy(new Request(`${protocol}://${host}${path}`, {
        method: request.method, body, headers: Object.entries(request.headers).flatMap(([key, value]) => typeof value === 'string' && (key === 'origin' || key === 'sec-fetch-site') ? [[key, value]] : []),
      }), endpoints.get('monero-main')![0], fetchUpstream)
      if (response.destroyed) return void reply.body?.cancel()
      response.writeHead(reply.status, Object.fromEntries(reply.headers))
      if (reply.body) Readable.fromWeb(reply.body as never).on('error', () => response.destroy()).pipe(response)
      else response.end()
      return
    }
    if (path.startsWith('/api/market/')) {
      const result = await market(path, request.method)
      if (!response.destroyed) response.writeHead(result.status).end(result.body)
      return
    }
    // WalletConnect project id lives in a worker secret, not in the code.
    if (path === '/api/walletconnect') return request.method === 'GET' ? void response.end(JSON.stringify({ projectId: env.STILL_WALLETCONNECT_PROJECT_ID ?? '' })) : fail(405)
    if (path.startsWith('/api/swap/')) return void await swapProxy(path, request, response, fail)
    if (path.startsWith('/api/tokens/')) return void await tokenList(path, request, response, fail)
    const match = /^\/api\/rpc\/([a-z\d]+-main)(\/[^?#]*)?(\?[^#]*)?$/.exec(path)
    if (!match || !Object.hasOwn(networks, match[1])) return fail(404)
    const isRest = restChains.has(networks[match[1] as NetworkId].chain)
    if (match[3] && !isRest) return fail(404)
    if (active >= 32) return fail(429)

    active++
    const controller = new AbortController()
    const cancel = () => controller.abort()
    response.once('close', cancel)
    const deadline = setTimeout(() => {
      controller.abort()
      if (!request.complete) request.destroy()
    }, 11_000)
    try {
      const network = networks[match[1] as NetworkId]
      const [endpoint, ...spares] = endpoints.get(network.id)!.map((url) => new URL(url))
      const suffix = match[2] ?? ''
      const isBitcoin = utxoChains.has(network.chain)
      const isTron = network.chain === 'tron'
      const isKaspa = network.chain === 'kaspa'
      // These providers aren't Esplora, the routes below translate.
      const translated = ['dogecoin', 'bitcoincash', 'dash', 'zcash'].includes(network.chain)
      const isAptos = network.chain === 'aptos'
      const method = request.method
      let body: string | Uint8Array<ArrayBuffer> | undefined
      let upstreamBody: string | Uint8Array<ArrayBuffer> | undefined
      let contentType = isBitcoin ? 'text/plain' : isAptos ? 'application/x.aptos.signed_transaction+bcs' : 'application/json'
      if (isRest) {
        if (method === 'POST') {
          if (Number(request.headers['content-length']) > requestLimit) throw new GatewayError(413)
          body = (await readBody(request)).toString('utf8')
        }
        const route = restRoute(network.chain, suffix + (match[3] ?? ''), method, body as string | undefined)
        if (!route) throw new GatewayError(405)
        const target = new URL(route.path, 'http://localhost')
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + target.pathname
        endpoint.search = target.search
        upstreamBody = route.body
        if (route.type) contentType = route.type
      } else if (isBitcoin) {
        if (!(method === 'GET' && bitcoinGet.test(suffix)) && !(method === 'POST' && suffix === '/tx')) throw new GatewayError(405)
        if (!translated) endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + suffix
      } else if (isKaspa) {
        if (!(method === 'GET' && kaspaPath.test(suffix)) && !(method === 'POST' && suffix === '/transactions')) throw new GatewayError(405)
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + suffix
      } else if (isTron) {
        if (method !== 'POST' || !tronPaths.has(suffix)) throw new GatewayError(405)
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + suffix
      } else if (isAptos) {
        if (!(method === 'GET' && aptosGet.test(suffix)) && !(method === 'POST' && aptosPost.has(suffix))) throw new GatewayError(405)
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + suffix
      } else if (method !== 'POST' || suffix) throw new GatewayError(405)
      if (method === 'POST' && !isRest) {
        if (Number(request.headers['content-length']) > requestLimit) throw new GatewayError(413)
        const raw = await readBody(request)
        body = isAptos ? new Uint8Array(raw) : raw.toString('utf8')
        if (typeof body !== 'string') {
          // Signed Aptos transactions are BCS bytes.
          if (!body.length) throw new GatewayError(400)
        } else if (isBitcoin) {
          if (body.length % 2 !== 0 || !hex.test(body)) throw new GatewayError(400)
        } else if (isTron || isKaspa) {
          let payload
          try { payload = JSON.parse(body) } catch { throw new GatewayError(400) }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new GatewayError(400)
        } else if (network.chain === 'sui') {
          let payload
          try { payload = JSON.parse(body) } catch { throw new GatewayError(400) }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.query !== 'string' || payload.query.length > 32 * 1024 || /^\s*subscription\b/.test(payload.query)) throw new GatewayError(400)
          // Only the Sui SDK's own operations, and sending a signed transaction is the only change the wallet makes.
          const operation = /^\s*(query|mutation)\s+([A-Za-z]+)\b/.exec(payload.query)
          if (!operation || !(operation[1] === 'mutation' ? operation[2] === 'executeTransaction' : suiQueries.has(operation[2]))) throw new GatewayError(400)
          if ((payload.query.match(/\b(?:query|mutation|subscription)\s+[A-Za-z]/g) ?? []).length > 1) throw new GatewayError(400)
        } else {
          const custom = customRpcChains.has(network.chain)
          if (custom && !allowCustomRpc(network.chain, body)) throw new GatewayError(400)
          const payload = custom ? JSON.parse(body) as { id?: unknown; method: string } : allowRpc(network.chain === 'xrp' ? xrpMethods : network.chain === 'solana' ? solanaMethods : evmMethods, body)
          // The genesis hash never changes, so answer it here and save a provider call.
          if (payload.method === 'getGenesisHash' && network.genesis) {
            return void response.end(JSON.stringify({ jsonrpc: '2.0', result: network.genesis, id: payload.id ?? null }))
          }
        }
      }
      if (translated) {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
        const text = body as string | undefined
        const reply = network.chain === 'dash' ? await insightRoute(endpoint, suffix, method!, text, fetchUpstream, signal)
          : network.chain === 'zcash' ? await blockchairRoute(endpoint, suffix, method!, text, fetchUpstream, signal, env.STILL_BLOCKCHAIR_KEY)
          : await dogecoinRoute(endpoint, suffix, method!, text, fetchUpstream, signal)
        if (response.destroyed) return
        if (reply.type) response.setHeader('Content-Type', reply.type)
        response.statusCode = reply.status
        return void response.end(reply.body)
      }
      // Busy public providers drop some calls from shared Cloudflare IPs at random, so retry quickly before the backup.
      const attempts = spares.length ? [endpoint, endpoint, endpoint, ...spares] : [endpoint]
      let upstream: Response | undefined
      for (const [index, url] of attempts.entries()) {
        const last = index === attempts.length - 1
        if (upstream) await upstream.body?.cancel()
        upstream = undefined
        try {
          upstream = await fetchUpstream(url, {
            method, body: isRest ? upstreamBody : body, redirect: 'error',
            signal: last ? controller.signal : AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
            headers: { ...(body ? { 'Content-Type': contentType } : {}), ...(network.chain === 'ton' && env.STILL_TONCENTER_KEY ? { 'X-API-Key': env.STILL_TONCENTER_KEY } : {}) },
          })
        } catch (error) {
          if (controller.signal.aborted || last) throw error
          continue
        }
        if (upstream.ok || (upstream.status !== 429 && upstream.status < 500)) break
      }
      if (!upstream) throw new GatewayError(502)
      if (isRest && (upstream.status === 400 || upstream.status === 404)) response.statusCode = upstream.status
      else if (!upstream.ok) {
        await upstream.body?.cancel()
        return fail(upstream.status === 429 ? 429 : isBitcoin && upstream.status === 404 ? 404 : 502)
      }
      const reader = upstream.body?.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          length += value.length
          if (length > responseLimit) {
            await reader.cancel()
            throw new GatewayError(502)
          }
          chunks.push(value)
        }
      }
      if (isBitcoin && !/\/(?:address|status|utxo|fee-estimates|recommended)(?:\/|$)/.test(suffix)) {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      }
      response.end(Buffer.concat(chunks, length))
    } catch (error) {
      if (!response.destroyed) fail(error instanceof GatewayError ? error.status : controller.signal.aborted ? 504 : 502)
    } finally {
      clearTimeout(deadline)
      response.off('close', cancel)
      active--
    }
  }
}
