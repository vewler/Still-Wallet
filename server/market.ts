import { networks } from '../src/networks.ts'
import { tokenPriceIds } from '../src/tokens.ts'

const ids = [...new Set([...Object.values(networks).map((network) => network.priceId), ...tokenPriceIds()])].sort()
const currencies = new Set(['usd', 'eur', 'gbp', 'chf'])
const daysAllowed = new Set(['1', '7', '30', '365'])

type MarketResult = { status: number; body: string }

export function createMarket(env: NodeJS.ProcessEnv, request: typeof fetch) {
  const pro = env.STILL_COINGECKO_PRO_KEY
  const demo = env.STILL_COINGECKO_DEMO_KEY
  const headers = new Headers({ Accept: 'application/json', 'User-Agent': 'StillWallet/0.1' })
  if (pro) headers.set('x-cg-pro-api-key', pro)
  else if (demo) headers.set('x-cg-demo-api-key', demo)
  const root = pro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3'
  const cache = new Map<string, { expires: number; body: string }>()
  const pending = new Map<string, Promise<MarketResult>>()
  let throttledUntil = 0
  // Max 2 upstream calls at once, the rest queue.
  let running = 0
  const waiting: (() => void)[] = []
  const slot = async () => {
    while (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
  }
  const release = () => { running--; waiting.shift()?.() }
  const STALE = 60 * 60_000
  const reject = (status: number): MarketResult => ({ status, body: '{"error":"Market data unavailable"}' })

  return async (path: string, method: string | undefined): Promise<MarketResult> => {
    if (method !== 'GET') return reject(405)
    if (path.length > 256) return reject(400)
    const url = new URL(path, 'http://localhost')
    const currency = url.searchParams.get('currency') ?? ''
    if (!currencies.has(currency)) return reject(400)
    let upstream: string
    let ttl = 120_000
    if (url.pathname === '/api/market/prices') {
      upstream = `/simple/price?ids=${ids.join(',')}&vs_currencies=${currency}&include_24hr_change=true`
    } else if (url.pathname === '/api/market/sparklines') {
      upstream = `/coins/markets?ids=${ids.join(',')}&vs_currency=${currency}&sparkline=true`
      ttl = 15 * 60_000
    } else {
      const priceId = /^\/api\/market\/history\/([a-z0-9-]+)$/.exec(url.pathname)?.[1] ?? ''
      const days = url.searchParams.get('days') ?? ''
      if (!ids.includes(priceId) || !daysAllowed.has(days)) return reject(400)
      upstream = `/coins/${priceId}/market_chart?vs_currency=${currency}&days=${days}`
      ttl = (days === '1' ? 5 : days === '7' ? 15 : 60) * 60_000
    }
    const existing = cache.get(upstream)
    if (existing && existing.expires > Date.now()) return { status: 200, body: existing.body }
    // Stale but under an hour old: serve it while the provider is slow.
    const stale = existing && existing.expires + STALE > Date.now() ? { status: 200, body: existing.body } : undefined
    const loading = pending.get(upstream)
    if (loading) return loading
    if (throttledUntil > Date.now() || waiting.length >= 64) return stale ?? reject(429)

    const load = (async (): Promise<MarketResult> => {
      await slot()
      try {
        const response = await request(root + upstream, { headers, redirect: 'error', signal: AbortSignal.timeout(8_000) })
        if (!response.ok) {
          await response.body?.cancel()
          if (response.status === 429) throttledUntil = Date.now() + 15_000
          return stale ?? reject(response.status === 429 ? 429 : 502)
        }
        // The fixed list of coins and chart ranges bound normal provider responses.
        const body = await response.text()
        if (body.length > 512 * 1024) return stale ?? reject(502)
        for (const [key, item] of cache) if (item.expires + STALE <= Date.now()) cache.delete(key)
        if (cache.size >= 96) cache.delete(cache.keys().next().value!)
        cache.set(upstream, { body, expires: Date.now() + ttl })
        return { status: 200, body }
      } catch {
        return stale ?? reject(502)
      } finally {
        release()
      }
    })()
    pending.set(upstream, load)
    try { return await load } finally { pending.delete(upstream) }
  }
}
