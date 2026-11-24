import type { IncomingMessage, ServerResponse } from 'node:http'
import { networks, type NetworkId } from '../src/networks.ts'
import { Readable } from 'node:stream'
import { createMarket } from './market.ts'
import { isMoneroPath, moneroProxy } from './monero.ts'

const evmMethods = new Set([
  'eth_chainId', 'eth_getBalance', 'eth_call', 'eth_estimateGas', 'eth_getBlockByNumber',
  'eth_maxPriorityFeePerGas', 'eth_gasPrice', 'eth_feeHistory', 'eth_getTransactionCount',
  'eth_sendRawTransaction', 'eth_getTransactionReceipt',
])
const solanaMethods = new Set([
  'getGenesisHash', 'getBalance', 'getMultipleAccounts', 'getAccountInfo', 'getTokenAccountBalance',
  'getLatestBlockhash', 'getFeeForMessage', 'getMinimumBalanceForRentExemption', 'getSignatureStatuses',
  'getBlockHeight', 'sendTransaction',
])
const xrpMethods = new Set(['server_info', 'account_info', 'fee', 'submit', 'tx'])
// Public providers rate-limit shared Cloudflare IPs, so busy chains get a second provider.
const backups: Partial<Record<string, string[]>> = {
  solana: ['https://api.mainnet-beta.solana.com'],
}
const hex = /^[a-f\d]+$/i
const bitcoinGet = /^\/(?:block-height\/0|fee-estimates|address\/bc1[a-z\d]{11,87}(?:\/utxo)?|tx\/[a-f\d]{64}\/(?:hex|status))$/
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
  if (!payload || Array.isArray(payload) || !methods.has(payload.method) ||
    (payload.params !== undefined && !Array.isArray(payload.params))) throw new GatewayError(400)
  if (payload.method === 'submit') {
    const [params] = payload.params ?? []
    if (payload.params?.length !== 1 || !params || typeof params.tx_blob !== 'string' || !hex.test(params.tx_blob) ||
      Object.keys(params).some((key) => key !== 'tx_blob' && key !== 'fail_hard')) throw new GatewayError(400)
  }
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
  // Per-client limit so the gateway can't be used as a free RPC/price proxy.
  const perMinute = Math.max(1, Number(env.STILL_RATE_LIMIT) || 240)
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
    if (path.startsWith('/api/swap/')) return void await swapProxy(path, request, response, fail)
    const match = /^\/api\/rpc\/([a-z]+-main)(\/[^?#]*)?$/.exec(path)
    if (!match || !Object.hasOwn(networks, match[1])) return fail(404)
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
      const isBitcoin = network.chain === 'bitcoin'
      const method = request.method
      let body: string | undefined
      if (isBitcoin) {
        if (!(method === 'GET' && bitcoinGet.test(suffix)) && !(method === 'POST' && suffix === '/tx')) throw new GatewayError(405)
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + suffix
      } else if (method !== 'POST' || suffix) throw new GatewayError(405)
      if (method === 'POST') {
        if (Number(request.headers['content-length']) > requestLimit) throw new GatewayError(413)
        body = (await readBody(request)).toString('utf8')
        if (isBitcoin) {
          if (body.length % 2 !== 0 || !hex.test(body)) throw new GatewayError(400)
        } else {
          const payload = allowRpc(network.chain === 'xrp' ? xrpMethods : network.chain === 'solana' ? solanaMethods : evmMethods, body)
          // The genesis hash never changes, so answer it here and save a provider call.
          if (payload.method === 'getGenesisHash' && network.genesis) {
            return void response.end(JSON.stringify({ jsonrpc: '2.0', result: network.genesis, id: payload.id ?? null }))
          }
        }
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
            method, body, redirect: 'error',
            signal: last ? controller.signal : AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
            headers: body ? { 'Content-Type': isBitcoin ? 'text/plain' : 'application/json' } : undefined,
          })
        } catch (error) {
          if (controller.signal.aborted || last) throw error
          continue
        }
        if (upstream.ok || (upstream.status !== 429 && upstream.status < 500)) break
      }
      if (!upstream) throw new GatewayError(502)
      if (!upstream.ok) {
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
      if (isBitcoin && !/\/(?:address|status|utxo|fee-estimates)(?:\/|$)/.test(suffix)) {
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
