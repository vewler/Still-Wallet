import { createServer } from 'node:http'
import { httpServerHandler } from 'cloudflare:node'
import { createGateway } from './gateway.ts'
import { isMoneroPath, moneroProxy, moneroUpstream } from './monero.ts'
import { networks } from '../src/networks.ts'

const gateway = createGateway(
  { ...process.env, STILL_TRUST_PROXY: '1' },
  // Workers accepts manual redirects. The gateway rejects the resulting 3xx without following it.
  // Cache market data at the edge so CoinGecko sees a few calls total, not one per instance
  // (it rate-limits Cloudflare IPs fast).
  (input, options) => globalThis.fetch(input, {
    ...options, redirect: 'manual',
    ...(String(input).includes('coingecko.com') ? { cf: { cacheEverything: true, cacheTtl: 120, cacheTtlByStatus: { '200-299': 120, '400-599': 0 } } } : {}),
    // Token lists for discovery: short edge cache, these APIs rate-limit shared IPs too.
    ...(/blockscout\.com|routescan\.io|trongrid\.io|pancakeswap\.finance|tokens\.uniswap\.org/.test(String(input)) ? { cf: { cacheEverything: true, cacheTtl: 60, cacheTtlByStatus: { '200-299': 60, '400-599': 0 } } } : {}),
  }),
)
const monero = moneroUpstream(process.env, networks['monero-main'].rpc)

const node = httpServerHandler(createServer((request, response) => {
  // Use Cloudflare's client IP, not X-Forwarded-For.
  request.headers['x-forwarded-for'] = request.headers['cf-connecting-ip']
  void gateway(request, response, () => response.writeHead(404).end())
}))

const home = 'https://stillwallet.net'
const homeHosts = new Set(['stillwallet.net', 'www.stillwallet.net'])
// Paths the worker answers itself, everything else is a static asset.
const workerPath = /^\/(api\/|get_|json_rpc$|getheight$|getinfo$|gettransactions$|send_raw_transaction$|sendrawtransaction$|is_key_image_spent$)|\.bin$/
// Replaces the old PWA's worker on the retired host: wipe caches, drop itself, send open windows home.
const retireWorker = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key)
  await self.clients.claim()
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  await self.registration.unregister()
  for (const client of windows) {
    const url = new URL(client.url)
    client.navigate('${home}' + url.pathname + url.search).catch(() => {})
  }
})()))
`

// Per-IP budgets in Cloudflare's shared rate limiter. Imported-token prices each cost a CoinGecko call, so they get a tight one.
async function overLimit(request, env, url) {
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const limiter = isMoneroPath(url.pathname) ? env.MONERO_LIMIT : url.pathname === '/api/market/token-prices' ? env.PRICE_LIMIT : env.API_LIMIT
  if (!limiter) return false
  try { return !(await limiter.limit({ key: client })).success } catch { return false }
}
const tooMany = () => new Response('{"error":"RPC request rejected"}', {
  status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' },
})

export default {
  // Monero replies go straight through as streams, the node adapter would copy every block batch.
  async fetch(request, env, context) {
    const url = new URL(request.url)
    if (!homeHosts.has(url.hostname)) {
      if (url.pathname === '/sw.js') return new Response(retireWorker, { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' } })
      return Response.redirect(home + url.pathname + url.search, 301)
    }
    if (url.protocol === 'http:') return Response.redirect(home + url.pathname + url.search, 301)
    if (!workerPath.test(url.pathname)) return env.ASSETS.fetch(request)
    if (url.pathname !== '/api/health' && await overLimit(request, env, url)) return tooMany()
    if (isMoneroPath(url.pathname)) return moneroProxy(request, monero)
    return node.fetch(request, env, context)
  },
}
