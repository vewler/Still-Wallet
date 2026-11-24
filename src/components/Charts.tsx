import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Dialog } from './Dialog'
import { allAssets, arrangeList, type Asset, type AssetLayout } from '../assets'
import type { Preferences } from '../storage'
import { Coin, TokenIcon } from './Icons'
import { Heading } from './Pages'
import { ManageCoins } from './Manage'
import { t } from '../i18n'

const ranges = [['1', '24h'], ['7', '7d'], ['30', '30d'], ['365', '1y']] as const
type Days = typeof ranges[number][0]
const DAYS_KEY = 'still.charts.days'
type History = { points: number[]; first: number; last: number }

// Phone and desktop keep separate chart lists.
const layoutKey = () => `still.charts.v1.${document.documentElement.dataset.layout ?? 'desktop'}`
const defaultIds = ['bitcoin-main', 'ethereum-main', 'solana-main', 'bnb-main']
const defaultCharts: AssetLayout = { order: defaultIds, shown: defaultIds }

/** One chart per price (USDC on 3 chains = 1 chart). */
function chartUniverse(environment: Preferences['environment']) {
  // Imported tokens have no price history.
  const all = allAssets(environment).filter((asset) => !asset.token?.user)
  return all.filter((asset, index) => all.findIndex((other) => other.priceId === asset.priceId) === index)
}

function readLayout(): AssetLayout {
  try {
    const value = JSON.parse(localStorage.getItem(layoutKey()) ?? localStorage.getItem('still.charts.v1') ?? 'null') as AssetLayout | null
    if (value && Array.isArray(value.order) && Array.isArray(value.shown)) return { order: value.order.filter((id) => typeof id === 'string'), shown: value.shown.filter((id) => typeof id === 'string') }
  } catch { /* Fall back to the default charts. */ }
  return defaultCharts
}

function shownCharts(environment: Preferences['environment'], layout: AssetLayout) {
  return arrangeList(chartUniverse(environment), layout).filter((entry) => entry.shown).map((entry) => entry.asset)
}

// Price history is the same for everyone: cache it locally, show it right away, refresh after the range TTL.
type Entry = History & { at: number }
const CACHE_KEY = 'still.chartCache.v1'
const ttl: Record<Days, number> = { '1': 5 * 60_000, '7': 15 * 60_000, '30': 60 * 60_000, '365': 6 * 60 * 60_000 }
const cache = new Map<string, Entry>(readCache())
const daysOf = (key: string) => key.split(':')[1] as Days
const isFresh = (key: string) => { const entry = cache.get(key); return !!entry && Date.now() - entry.at < ttl[daysOf(key)] }

function readCache(): [string, Entry][] {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Entry>
    // Drop entries older than a day or malformed.
    return Object.entries(stored).filter(([, entry]) => entry && Array.isArray(entry.points) && entry.points.length > 1 && Date.now() - entry.at < 86_400_000)
  } catch { return [] }
}
let saveTimer: number | undefined
function store(key: string, history: History) {
  cache.set(key, { ...history, at: Date.now() })
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache))) } catch { /* Memory cache still works. */ } }, 500)
}

const pending = new Map<string, Promise<History | 'error'>>()
const batches = new Map<string, Promise<void>>()
const toHistory = (points: number[]): History | 'error' => points.length > 1 ? { points, first: points[0], last: points[points.length - 1] } : 'error'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// CoinGecko free tier allows a few calls/min per IP. Single-coin requests run one at a time ~6s apart and back off on 429.
let queue: Promise<unknown> = Promise.resolve()
function queued<T>(task: () => Promise<T>) {
  const run = queue.then(task, task)
  queue = run.then(() => sleep(6000), () => sleep(6000))
  return run
}
async function withRetry<T>(task: () => Promise<T>) {
  for (let attempt = 0; ; attempt++) {
    try { return await task() } catch (problem) {
      const status = (problem as { status?: number }).status
      if (attempt >= 3 || (status !== undefined && status !== 429)) throw problem
      await sleep(15_000 * 2 ** attempt)
    }
  }
}

/** 7d lines for all coins in one request, fills the cache. */
async function loadSparklines(assets: Asset[], currency: string): Promise<void> {
  // Reuse a batch already in flight (e.g. the prefetch).
  await Promise.allSettled([...batches.values()])
  const missing = assets.filter((asset) => !isFresh(`${asset.priceId}:7:${currency}`))
  if (!missing.length) return
  const key = `sparklines:${currency}:${missing.map((asset) => asset.priceId).join(',')}`
  let request = batches.get(key)
  if (!request) {
    request = withRetry(() => import('../rpc').then(({ getSparklines }) => getSparklines(missing.map((asset) => asset.priceId), currency, new AbortController().signal)))
      .then((lines) => { for (const asset of missing) { const history = lines[asset.priceId] && toHistory(lines[asset.priceId]); if (history && history !== 'error') store(`${asset.priceId}:7:${currency}`, history) } })
      .finally(() => batches.delete(key))
    batches.set(key, request)
  }
  return request
}

/** Dedupe requests per coin/range/currency. */
function loadHistory(asset: Asset, days: Days, currency: string) {
  const key = `${asset.priceId}:${days}:${currency}`
  if (isFresh(key)) return Promise.resolve<History | 'error'>(cache.get(key)!)
  let request = pending.get(key)
  if (!request) {
    const single = () => queued(() => withRetry(() => import('../rpc').then(({ getPriceHistory }) => getPriceHistory(asset.priceId, currency, Number(days), new AbortController().signal))))
      .then(toHistory)
    // 7d normally comes from the batch, fall back to a single request.
    request = (days === '7' ? loadSparklines([asset], currency).catch(() => undefined).then(() => isFresh(key) ? cache.get(key)! : single()) : single())
      // Only cache successes so a 429'd coin retries later.
      .then((value) => { if (value !== 'error' && !isFresh(key)) store(key, value); return value })
      .finally(() => pending.delete(key))
    pending.set(key, request)
  }
  return request
}

/** Prefetch every range for the visible charts. 7d is batched, the rest queued for rate limits. */
export async function prefetchCharts(environment: Preferences['environment'], currency: string) {
  const shown = shownCharts(environment, readLayout())
  await loadSparklines(shown, currency).catch(() => undefined)
  for (const days of ['1', '30', '365'] as const) for (const asset of shown) void loadHistory(asset, days, currency).catch(() => undefined)
}

export function ChartsPage({ preferences }: { preferences: Preferences }) {
  const [days, setDaysState] = useState<Days>(() => { const saved = localStorage.getItem(DAYS_KEY); return ranges.some(([value]) => value === saved) ? saved as Days : '7' })
  const setDays = (value: Days) => { setDaysState(value); try { localStorage.setItem(DAYS_KEY, value) } catch { /* Keep it for this visit. */ } }
  const [layout, setLayout] = useState(readLayout)
  const [managing, setManaging] = useState(false)
  const shown = shownCharts(preferences.environment, layout)
  const [ready, setReady] = useState(() => shown.every((asset) => cache.has(`${asset.priceId}:7:${preferences.currency}`)))

  // Batch the visible 7d lines before the cards mount.
  useEffect(() => {
    if (preferences.offline || days !== '7') { setReady(true); return }
    let current = true
    void loadSparklines(shown, preferences.currency).catch(() => undefined).finally(() => { if (current) setReady(true) })
    return () => { current = false }
  }, [days, preferences.currency, preferences.offline, shown.map((asset) => asset.priceId).join(',')])

  function save(next: AssetLayout) {
    setLayout(next)
    try { localStorage.setItem(layoutKey(), JSON.stringify(next)) } catch { /* Keep the change for this visit. */ }
  }

  return <div className="page charts-page">
    <Heading title="Charts" action={<div className="charts-actions">
      <Toggle className="charts-range" label={t('Time range')} options={ranges} value={days} set={setDays} />
      <button type="button" className="round-button" aria-label={t('Manage charts')} onClick={() => setManaging(true)}><SlidersHorizontal size={18} /></button>
    </div>} />
    {preferences.offline ? <p className="field-note">{t('Network requests are paused, so charts can’t load. Turn them back on in Settings.')}</p>
      : shown.length === 0 ? <p className="field-note">{t('No charts turned on. Use the manage button to add some.')}</p>
      : <div className="chart-grid">{shown.map((asset) => <ChartCard key={`${asset.priceId}-${preferences.currency}`} asset={asset} days={days} currency={preferences.currency} ready={ready} />)}</div>}
    <p className="field-note">{t('Prices from CoinGecko.')}</p>
    {managing && <ManageCoins environment={preferences.environment} assets={chartUniverse(preferences.environment)} layout={layout} defaults={defaultCharts} save={save} place="in Charts" close={() => setManaging(false)} />}
  </div>
}

const money = (value: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: value < 1 ? 6 : 2 }).format(value)
const changeOf = (history: History) => (history.last - history.first) / history.first * 100

/** History for one coin/range: cache first, refresh if stale. */
function useHistory(asset: Asset, days: Days, currency: string, ready = true) {
  const key = `${asset.priceId}:${days}:${currency}`
  const [history, setHistory] = useState<History | 'error' | undefined>(() => cache.get(key))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setHistory(cache.get(key))
    if (isFresh(key) || !ready) return
    let current = true
    loadHistory(asset, days, currency)
      // On failure keep the old chart.
      .then((value) => { if (current) setHistory(value === 'error' ? cache.get(key) ?? 'error' : value) })
      .catch(() => { if (current) setHistory(cache.get(key) ?? 'error') })
    return () => { current = false }
  }, [key, asset, currency, days, ready, attempt])

  return [history, () => { setHistory(undefined); setAttempt((value) => value + 1) }] as const
}

function ChartCard({ asset, days, currency, ready }: { asset: Asset; days: Days; currency: string; ready: boolean }) {
  const [loaded, retry] = useHistory(asset, days, currency, ready)
  // Range switch: keep the old line until the new one arrives, then morph.
  const last = useRef<History>(undefined)
  if (loaded && loaded !== 'error') last.current = loaded
  const history = loaded ?? last.current
  const [open, setOpen] = useState(false)
  const change = history && history !== 'error' ? changeOf(history) : undefined
  const up = (change ?? 0) >= 0
  return <article className="chart-card">
    <button type="button" className="chart-hit" aria-label={t('Open {name} chart', { name: asset.name })} onClick={() => setOpen(true)} />
    <header>
      {asset.token ? <TokenIcon token={asset.token} /> : <Coin chain={asset.chain} />}
      <span className="chart-name"><strong>{asset.name}</strong><small>{asset.symbol}</small></span>
      {history && history !== 'error' && <span className="chart-price">
        <strong>{money(history.last, currency)}</strong>
        <small className={up ? 'up' : 'danger-text'}>{up ? '+' : ''}{change!.toFixed(2)}%</small>
      </span>}
    </header>
    {history === 'error' ? <p className="chart-empty">{t('Chart unavailable right now.')} <button type="button" className="text-link" onClick={retry}>{t('Try again')}</button></p>
      : history ? <MorphLine points={history.points} up={up} label={t('{name} price, {change}% over the period', { name: asset.name, change: change!.toFixed(2) })} />
      : <div className="chart-loading" aria-label={t('Loading chart')} />}
    {open && <ChartView asset={asset} days={days} currency={currency} close={() => setOpen(false)} />}
  </article>
}

type Kind = 'line' | 'candle'
let lastKind: Kind = 'line' // remembered between opens for this visit
const kinds = [['line', 'Line'], ['candle', 'Candles']] as const

/** Segmented control with a sliding pill. */
function Toggle<T extends string>({ className, label, options, value, set }: { className: string; label: string; options: readonly (readonly [T, string])[]; value: T; set: (value: T) => void }) {
  const index = options.findIndex(([option]) => option === value)
  return <div className={`segmented segmented--slide ${className}`} role="group" aria-label={label} style={{ '--n': options.length, '--i': index } as CSSProperties}>
    <span className="segmented-pill" aria-hidden="true" />
    {options.map(([option, text]) => <button key={option} type="button" aria-pressed={value === option} onClick={() => set(option)}>{t(text)}</button>)}
  </div>
}

const tween = (ms: number, step: (t: number) => void) => {
  const start = performance.now()
  let frame = 0
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    step(1 - (1 - t) ** 3) // ease-out cubic
    if (t < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}

/** Number that counts from its old value to the new one. */
export function useRolling(value: number, ms = 333) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    return tween(ms, (t) => { from.current = start + (value - start) * t; setShown(from.current) })
  }, [value, ms])
  return shown
}

export function Rolling({ value, format, ms = 333 }: { value: number; format: (value: number) => string; ms?: number }) {
  // Writes the text each frame without re-rendering. Smoother on phones.
  const span = useRef<HTMLSpanElement>(null)
  const from = useRef(value)
  const formatRef = useRef(format)
  formatRef.current = format
  useEffect(() => {
    const start = from.current
    // Edits React's own text node so the two never fight.
    const write = (shown: number) => { const text = span.current?.firstChild; if (text) text.nodeValue = formatRef.current(shown) }
    if (start === value) { write(value); return }
    return tween(ms, (t) => { from.current = start + (value - start) * t; write(from.current) })
  }, [value, ms])
  return <span ref={span} className="rolling">{format(from.current)}</span>
}

// Resample every range to the same point count so lines can morph.
const SAMPLES = 160
function resample(points: number[]) {
  return Array.from({ length: SAMPLES }, (_, index) => {
    const at = index / (SAMPLES - 1) * (points.length - 1)
    const low = Math.floor(at), high = Math.min(points.length - 1, low + 1)
    return points[low] + (points[high] - points[low]) * (at - low)
  })
}
const toUnit = (points: number[]) => {
  const min = Math.min(...points), span = Math.max(...points) - min || 1
  return points.map((value) => (value - min) / span)
}

/** Line chart that morphs between ranges. */
export function MorphLine({ points, up, label }: { points: number[]; up: boolean; label: string }) {
  const target = toUnit(resample(points))
  const key = target.join(',')
  const current = useRef(target)
  const area = useRef<SVGPathElement>(null)
  const stroke = useRef<SVGPathElement>(null)
  const width = 320, height = 110
  const pathOf = (shape: number[]) => shape.map((value, index) => `${index ? 'L' : 'M'}${(index / (SAMPLES - 1) * width).toFixed(1)},${(height - 6 - value * (height - 12)).toFixed(1)}`).join('')
  // The morph writes paths to the SVG each frame, bypassing React. No-op when the shape is unchanged.
  useEffect(() => {
    const start = current.current
    if (start.every((value, index) => value === target[index])) return
    return tween(550, (t) => {
      current.current = start.map((value, index) => value + (target[index] - value) * t)
      // Re-stretch each frame to full height so the line does not shrink mid-morph.
      const line = pathOf(toUnit(current.current))
      stroke.current?.setAttribute('d', line)
      area.current?.setAttribute('d', `${line}L${width},${height}L0,${height}Z`)
    })
  }, [key])
  const line = pathOf(current.current)
  return <svg className={`sparkline ${up ? 'sparkline--up' : 'sparkline--down'}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    <path ref={area} className="sparkline-area" d={`${line}L${width},${height}L0,${height}Z`} />
    <path ref={stroke} className="sparkline-line" d={line} vectorEffect="non-scaling-stroke" />
  </svg>
}

/** Crossfade: old fades out under the new one, never an empty frame. */
export function CrossFade({ id, children, ms = 63 }: { id: string; children: ReactNode; ms?: number }) {
  const [previous, setPrevious] = useState<{ id: string; node: ReactNode }>()
  const shown = useRef({ id, node: children })
  if (shown.current.id !== id) {
    setPrevious(shown.current)
    shown.current = { id, node: children }
  } else shown.current.node = children
  useEffect(() => {
    if (!previous) return
    const timer = window.setTimeout(() => setPrevious(undefined), ms)
    return () => window.clearTimeout(timer)
  }, [previous, ms])
  return <span className="crossfade">
    {previous && <span key={previous.id} className="crossfade-out" aria-hidden="true" style={{ animationDuration: `${ms}ms` }}>{previous.node}</span>}
    <span key={id} className={previous ? 'crossfade-in' : undefined} style={previous ? { animationDuration: `${ms}ms` } : undefined}>{children}</span>
  </span>
}

// Assumes evenly spaced points ending now (true for market_chart).
function axisLabels(days: Days) {
  const span = Number(days) * 86_400_000, now = Date.now()
  const format = days === '1' ? { hour: 'numeric' } as const : days === '365' ? { month: 'short' } as const : { month: 'short', day: 'numeric' } as const
  return Array.from({ length: 5 }, (_, index) => new Date(now - span + span * index / 4).toLocaleString('en-US', format))
}

/** Full chart for one coin: range + line/candles. */
function ChartView({ asset, days: startDays, currency, close }: { asset: Asset; days: Days; currency: string; close: () => void }) {
  const [days, setDays] = useState<Days>(startDays)
  const [kind, setKind] = useState<Kind>(lastKind)
  const [fresh, retry] = useHistory(asset, days, currency)
  // Keep the previous range while loading so it morphs.
  const good = useRef<History | undefined>(undefined)
  if (fresh && fresh !== 'error') good.current = fresh
  const history = fresh === 'error' ? 'error' : good.current
  const change = history && history !== 'error' ? changeOf(history) : undefined
  const up = (change ?? 0) >= 0
  const label = ranges.find(([value]) => value === days)![1]

  return <Dialog title={`${asset.name} · ${asset.symbol}`} close={close}>
    <div className="chart-view">
      <div className="chart-view-price">
        <strong>{history && history !== 'error' ? <Rolling value={history.last} format={(value) => money(value, currency)} /> :' '}</strong>
        <small className={up ? 'up' : 'danger-text'}>{change === undefined ?' ' : <><Rolling value={change} format={(value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`} /> · <CrossFade id={label}>{t(label)}</CrossFade></>}</small>
      </div>
      <div className="chart-view-plot">
        {history === 'error' ? <p className="chart-empty">{t('Chart unavailable right now.')} <button type="button" className="text-link" onClick={retry}>{t('Try again')}</button></p>
          : !history ? <div className="chart-loading" aria-label={t('Loading chart')} />
          : kind === 'line' ? <MorphLine points={history.points} up={up} label={t('{name} price over {range}', { name: asset.name, range: t(label) })} />
          : <Candles points={history.points} count={candleCount[days]} label={t('{name} candles over {range}', { name: asset.name, range: t(label) })} />}
        {history && history !== 'error' ? <CrossFade id={days}><div className="chart-axis" aria-hidden="true">{axisLabels(days).map((text, index) => <span key={index}>{text}</span>)}</div></CrossFade>
          : <div className="chart-axis" aria-hidden="true" />}
      </div>
      <dl className="chart-view-stats">
        <div><dt>{t('High')}</dt><dd>{history && history !== 'error' ? <Rolling value={Math.max(...history.points)} format={(value) => money(value, currency)} /> : '—'}</dd></div>
        <div><dt>{t('Low')}</dt><dd>{history && history !== 'error' ? <Rolling value={Math.min(...history.points)} format={(value) => money(value, currency)} /> : '—'}</dd></div>
      </dl>
      <div className="chart-view-controls">
        <Toggle className="charts-range" label={t('Time range')} options={ranges} value={days} set={setDays} />
        <Toggle className="chart-kind" label={t('Chart type')} options={kinds} value={kind} set={(value) => { lastKind = value; setKind(value) }} />
      </div>
    </div>
  </Dialog>
}

// Candles are bucketed from the line points, not real OHLC. Use /ohlc if exact wicks ever matter.
const candleCount: Record<Days, number> = { '1': 24, '7': 28, '30': 30, '365': 52 }
export function toCandles(points: number[], count: number) {
  const size = Math.max(1, Math.ceil((points.length - 1) / count))
  const candles: { open: number; close: number; high: number; low: number }[] = []
  // Each bucket opens at the previous close.
  for (let start = 0; start < points.length - 1; start += size) {
    const slice = points.slice(start, Math.min(points.length, start + size + 1))
    candles.push({ open: slice[0], close: slice[slice.length - 1], high: Math.max(...slice), low: Math.min(...slice) })
  }
  return candles
}

type Shape = { x: number; w: number; open: number; close: number; high: number; low: number }

/** Candles ease from their old position/width/prices on a range change. */
function Candles({ points, count, label }: { points: number[]; count: number; label: string }) {
  const width = 320, height = 110
  const min = Math.min(...points), span = Math.max(...points) - min || 1
  const unit = (value: number) => (value - min) / span
  const raw = toCandles(points, count)
  const target: Shape[] = raw.map((candle, index) => ({ x: (index + .5) / raw.length, w: 1 / raw.length, open: unit(candle.open), close: unit(candle.close), high: unit(candle.high), low: unit(candle.low) }))
  const [shapes, setShapes] = useState(target)
  const current = useRef(target)
  const key = target.map((shape) => shape.close).join(',')
  useEffect(() => {
    const before = current.current
    const start = target.map((_, index) => before[Math.round(index * (before.length - 1) / Math.max(1, target.length - 1))] ?? target[index])
    return tween(450, (t) => {
      current.current = target.map((end, index) => {
        const from = start[index]
        const mix = (a: number, b: number) => a + (b - a) * t
        return { x: mix(from.x, end.x), w: mix(from.w, end.w), open: mix(from.open, end.open), close: mix(from.close, end.close), high: mix(from.high, end.high), low: mix(from.low, end.low) }
      })
      setShapes(current.current)
    })
  }, [key])
  const y = (value: number) => height - 6 - value * (height - 12)
  return <svg className="candles" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    {shapes.map((shape, index) => {
      const x = shape.x * width, top = y(Math.max(shape.open, shape.close)), bottom = y(Math.min(shape.open, shape.close))
      // Color follows the target candle, no flicker.
      const up = (target[index] ?? shape).close >= (target[index] ?? shape).open
      return <g key={index} className={up ? 'candle--up' : 'candle--down'}>
        <line x1={x} x2={x} y1={y(shape.high)} y2={y(shape.low)} vectorEffect="non-scaling-stroke" />
        <rect x={x - shape.w * width * .32} width={shape.w * width * .64} y={top} height={Math.max(.8, bottom - top)} />
      </g>
    })}
  </svg>
}
