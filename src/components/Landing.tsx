import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, Globe2, KeyRound, LockKeyhole, QrCode, RefreshCw, ShieldCheck, Shuffle, Timer, Wallet, WifiOff } from 'lucide-react'
import { Brand, Coin, TokenIcon } from './Icons'
import { CrossFade, MorphLine } from './Charts'
import { networks, type Chain } from '../networks'
import { tokens } from '../tokens'
import { smoothScrollTo } from '../scroll'
import './landing.css'
import { t } from '../i18n'

// Works with: fixed order (not by market cap) so the strip never reshuffles. First 8 always show, the rest appear as the window grows.
const worksWithOrder: [priceId: string, name: string][] = [
  ['bitcoin', 'Bitcoin'], ['ethereum', 'Ethereum'], ['solana', 'Solana'], ['litecoin', 'Litecoin'], ['usd-coin', 'USD Coin'], ['monero', 'Monero'], ['ripple', 'XRP'], ['binancecoin', 'BNB'],
  ['tether', 'Tether'], ['tron', 'TRON'], ['zcash', 'Zcash'], ['dogecoin', 'Dogecoin'], ['the-open-network', 'Toncoin'], ['hyperliquid', 'Hyperliquid'], ['avalanche-2', 'Avalanche'], ['cardano', 'Cardano'],
  ['sui', 'Sui'], ['polygon-ecosystem-token', 'Polygon'], ['bitcoin-cash', 'Bitcoin Cash'], ['chainlink', 'Chainlink'],
]
type WorksWithCoin = { id: string; name: string; symbol: string; chain?: Chain; color: string }
const worksWith = worksWithOrder.flatMap(([id, name]): WorksWithCoin[] => {
  const network = Object.values(networks).find((entry) => entry.priceId === id)
  if (network) return [{ id, name, symbol: network.symbol, chain: network.chain, color: '' }]
  const token = tokens.find((entry) => entry.priceId === id)
  return token ? [{ id, name, symbol: token.symbol, chain: undefined, color: token.color }] : []
})

export const discord = 'https://discord.gg/ow2'

// Full reload on edit in dev. HMR can leave old animations running.
import.meta.hot?.accept(() => location.reload())

type LandingProps = {
  mode: 'none' | 'locked' | 'wallet'
  mainRef: Ref<HTMLElement>
  openWallet: () => void
}

const features = [
  { icon: KeyRound, title: 'Your keys, your device', text: 'Your recovery phrase is encrypted in your browser and never sent anywhere. Set up without an account or email.' },
  { icon: Globe2, title: 'Every token on its own chain', text: 'BTC, ETH, SOL, BNB, XRP, XMR, HYPE, USDC, USDT and LINK on their native networks, with balances in your own currency.' },
  { icon: Wallet, title: 'Many wallets', text: 'Keep several wallets side by side, each with its own name and emoji, and switch in a tap.' },
  { icon: Timer, title: 'Locks when you leave', text: 'Auto-lock from instant to 30 minutes, plus optional protection that erases the wallet after too many wrong passwords.' },
  { icon: WifiOff, title: 'Quiet by default', text: 'Hide balances, pause network requests and choose your own RPC for every network.' },
  { icon: RefreshCw, title: 'Installs like an app', text: 'Works on phone and PC, and keeps working offline once it has loaded.' },
]

const security = [
  ['AES-256-GCM', 'Vault encryption'],
  ['600k', 'PBKDF2 rounds on your password'],
  ['0', 'Trackers or analytics'],
  ['MIT', 'Open-source license'],
]


export function Landing({ mode, mainRef, openWallet }: LandingProps) {
  const action = mode === 'none' ? t('Get started') : mode === 'locked' ? t('Unlock wallet') : t('Open wallet')
  const root = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState('')
  // Keep the clicked nav item active while scrolling past other sections.
  const navTarget = useRef<string | null>(null)
  const scrollToSection = (id: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const section = document.getElementById(id)
    if (!section) return
    navTarget.current = id
    setActive(id)
    smoothScrollTo(section, () => {
      navTarget.current = null
      section.focus({ preventScroll: true })
    })
  }

  // Works with: 1 row once the first 8 fit side by side (more join as it widens), else 2 rows of 4 to 10. Same item size at every width. Fixed priority order.
  useEffect(() => {
    const inner = root.current?.querySelector<HTMLElement>('.chains-inner')
    const grid = inner?.querySelector<HTMLElement>('.chain-logos')
    if (!inner || !grid) return
    const fit = () => {
      const items = [...grid.children] as HTMLElement[]
      const box = getComputedStyle(grid)
      // Room for the coins inside the outlined box.
      const full = inner.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight) - parseFloat(box.borderLeftWidth) - parseFloat(box.borderRightWidth)
      const gap = parseFloat(box.columnGap)
      let sizes: number[] = []
      const measure = (short: boolean) => {
        grid.classList.toggle('is-short', short)
        grid.classList.add('is-measuring')
        sizes = items.map((item) => item.offsetWidth)
        grid.classList.remove('is-measuring')
      }
      const width = (cols: number) => Array.from({ length: cols }, (_, column) => Math.max(...sizes.slice(0, cols * 2).filter((_, index) => index % cols === column))).reduce((sum, value) => sum + value, 0) + gap * (cols - 1)
      const row = (count: number) => sizes.slice(0, count).reduce((sum, value) => sum + value, 0) + gap * (count - 1)
      const plan = (short: boolean) => {
        measure(short)
        // One row only with full names, once the first 8 fit side by side.
        if (!short && row(8) <= full) {
          let cols = 8
          while (cols < items.length && row(cols + 1) <= full) cols++
          return { cols, shown: cols }
        }
        let cols = Math.min(10, Math.floor(items.length / 2))
        while (cols > 4 && width(cols) > full) cols--
        return { cols, shown: cols * 2, fits: width(cols) <= full }
      }
      // Full names once 4 per row fit, else tickers 4 + 4 (phones).
      const named = plan(false)
      const short = 'fits' in named && !named.fits
      if (short) measure(true)
      const { cols, shown } = short ? { cols: 4, shown: 8 } : named
      items.forEach((item, index) => { item.hidden = index >= shown })
      grid.style.setProperty('--cols', String(cols))
    }
    fit()
    void document.fonts.ready.then(fit)
    const observer = new ResizeObserver(fit)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  // Track hover manually while the page scrolls under a still mouse (:hover only updates after scrolling stops).
  useEffect(() => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let x = -1, y = -1, frame = 0
    let current: Element | null = null
    const check = () => {
      frame = 0
      const target = x < 0 ? null : document.elementFromPoint(x, y)?.closest('.hover-card') ?? null
      if (target === current) return
      current?.classList.remove('is-hover')
      target?.classList.add('is-hover')
      current = target
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check) }
    const move = (event: PointerEvent) => { if (event.pointerType !== 'mouse') return; x = event.clientX; y = event.clientY; schedule() }
    const leave = () => { x = -1; schedule() }
    addEventListener('pointermove', move, { passive: true })
    addEventListener('scroll', schedule, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => { cancelAnimationFrame(frame); removeEventListener('pointermove', move); removeEventListener('scroll', schedule); document.removeEventListener('pointerleave', leave) }
  }, [])

  // Header shadow on scroll, plus the active section.
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setScrolled(scrollY > 8)
      const header = document.querySelector<HTMLElement>('.landing-header')?.offsetHeight ?? 0
      const probe = header + innerHeight * .3
      let current = ''
      for (const id of ['features', 'security-section', 'about']) {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        if (top !== undefined && top <= probe) current = id
      }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = 'about'
      if (!navTarget.current) setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll)
    return () => { cancelAnimationFrame(frame); removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll) }
  }, [])

  // Reveal sections on scroll, every time.
  useEffect(() => {
    const items = root.current?.querySelectorAll<HTMLElement>('.reveal') ?? []
    if (!('IntersectionObserver' in window)) { items.forEach((item) => item.classList.add('is-visible')); return }
    // Show at 12% visible, reset once fully offscreen.
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.intersectionRatio >= .12) entry.target.classList.add('is-visible')
      else if (!entry.isIntersecting) entry.target.classList.remove('is-visible')
    }), { rootMargin: '0px 0px -8% 0px', threshold: [0, .12] })
    items.forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

  return <div className="landing" ref={root}>
    <header className={`landing-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="landing-container landing-header-inner">
        <a className="landing-brand" href="/" aria-label={t('Still home')} onClick={(event) => { if (['/', '/about'].includes(location.pathname)) { event.preventDefault(); navTarget.current = null; smoothScrollTo(0) } }}><Brand /></a>
        <nav aria-label={t('Site')} className="landing-nav">
          <a className="landing-nav-link" aria-current={active === 'features' ? 'true' : undefined} href="#features" onClick={scrollToSection('features')}>{t('Features')}</a>
          <a className="landing-nav-link" aria-current={active === 'security-section' ? 'true' : undefined} href="#security-section" onClick={scrollToSection('security-section')}>{t('Security')}</a>
          <a className="landing-nav-link" aria-current={active === 'about' ? 'true' : undefined} href="#about" onClick={scrollToSection('about')}>{t('About')}</a>
          <button className="button primary landing-button" type="button" onClick={openWallet}>{action}</button>
        </nav>
      </div>
    </header>

    <main id="main-content" ref={mainRef} tabIndex={-1} className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="landing-container landing-hero-inner">
          <div className="landing-copy">
            <h1 id="landing-title">{t('Crypto')}<br /><span className="gradient-text">{t('kept still.')}</span></h1>
            <p>{t('A calm, privacy-first wallet for Bitcoin, Ethereum, Solana and more. Your recovery phrase never leaves your device.')}</p>
            <div className="landing-actions">
              <button className="button primary landing-button landing-button--big" type="button" onClick={openWallet}>{action}<ArrowRight size={19} /></button>
            </div>
            <ul className="hero-points">
              <li><ShieldCheck size={16} /> {t('No account or email')}</li>
              <li><LockKeyhole size={16} /> {t('Encrypted on device')}</li>
              <li><Globe2 size={16} /> {t('Open source')}</li>
            </ul>
          </div>
          <PhoneMockup />
        </div>
      </section>

      <section className="landing-chains reveal" aria-label={t('Supported networks')}>
        <div className="landing-container chains-inner">
          <span>{t('Works with')}</span>
          <div className="chain-logos">
            {worksWith.map((coin) => <span key={coin.id}>{coin.chain ? <Coin chain={coin.chain} /> : <span className="coin coin--token" style={{ background: coin.color }} aria-hidden="true"><b data-len={Math.min(coin.symbol.length, 5)}>{coin.symbol}</b></span>}<span className="chain-name">{coin.name}</span><span className="chain-symbol">{coin.symbol}</span></span>)}
          </div>
        </div>
        <p className="chains-more">{t('and more')}</p>
      </section>

      <section id="features" tabIndex={-1} className="landing-section landing-container" aria-labelledby="features-title">
        <div className="section-head reveal">
          <h2 id="features-title">{t('Small on purpose.')}<br /><span className="muted-text">{t('Eight chains, one phrase.')}</span></h2>
          <span className="eyebrow">{t('Features')}</span>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text }, index) => <article key={title} className="feature-card hover-card reveal" style={{ '--d': `${(index % 3) * 70}ms` } as CSSProperties}>
            <span className="feature-icon"><Icon size={22} /></span>
            <h3>{t(title)}</h3>
            <p>{t(text)}</p>
          </article>)}
        </div>
      </section>

      <section id="security-section" tabIndex={-1} className="landing-security" aria-labelledby="security-title">
        <div className="landing-container security-inner">
          <div className="reveal">
            <h2 id="security-title">{t('Your phrase stays encrypted.')}</h2>
            <span className="eyebrow">{t('Security')}</span>
            <p>{t('Still encrypts your recovery phrase with your password right in the browser. Nobody at ow2 can see it, reset it or move your funds. Still hasn’t had an independent audit yet, so start small on mainnet.')}</p>
          </div>
          <dl className="security-stats">
            {security.map(([value, label], index) => <div key={label} className="hover-card reveal" style={{ '--d': `${index * 70}ms` } as CSSProperties}><dt>{t(label)}</dt><dd>{value}</dd></div>)}
          </dl>
        </div>
      </section>

      <section className="landing-section landing-container" aria-labelledby="steps-title">
        <div className="section-head reveal">
          <h2 id="steps-title">{t('Set up in a minute.')}</h2>
          <span className="eyebrow">{t('Get going')}</span>
        </div>
        <ol className="steps">
          {[['Create or import', 'Make a new recovery phrase or bring your own.'], ['Back it up', 'Write the words down. They’re the only way back in.'], ['Send and receive', 'Pick a network, scan a QR code and you’re done.']].map(([title, text], index) => <li key={title} className="hover-card reveal" style={{ '--d': `${index * 80}ms` } as CSSProperties}>
            <span className="step-number">{index + 1}</span><h3>{t(title)}</h3><p>{t(text)}</p>
          </li>)}
        </ol>
      </section>

      <MarketSection action={mode === 'none' ? t('Watch it in Still') : action} openWallet={openWallet} />

      <section className="landing-cta reveal" aria-labelledby="cta-title">
        <div className="landing-container cta-inner">
          <h2 id="cta-title">{t('Ready to hold your own keys?')}</h2>
          <button className="button primary landing-button landing-button--big" type="button" onClick={openWallet}>{action}<ArrowRight size={19} /></button>
        </div>
      </section>

      <section id="about" className="landing-about landing-container reveal" aria-labelledby="about-title" tabIndex={-1}>
        <h2 id="about-title">{t('About ow2')}</h2>
        <div>
          <p>{t('ow2 created Still as an open-source wallet for people who want to hold their own keys and choose how they connect to a network.')}</p>
          <a className="landing-community" href={discord} target="_blank" rel="noreferrer">{t('Join the Discord')} <ArrowRight size={18} /></a>
        </div>
      </section>

    </main>

    <footer className="landing-footer landing-container">
      <span><strong>Still</strong> <small className="landing-build">{t('build')} {import.meta.env.VITE_BUILD}</small></span>
      <span className="landing-footer-links"><a href="#faq">{t('FAQ')}</a><a href="#credits">{t('Credits')}</a><a href="#privacy">{t('Privacy Policy')}</a><a href="/LICENSE.txt" target="_blank" rel="noreferrer">{t('MIT License')}</a></span>
    </footer>
  </div>
}

/** Static wallet preview, numbers are made up. */
function PhoneMockup() {
  const wrap = useRef<HTMLDivElement>(null)
  // 3D tilt that follows the mouse. Not on touch.
  useEffect(() => {
    const element = wrap.current
    if (!element || !matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const x = event.clientX / innerWidth - .5
        const y = event.clientY / innerHeight - .5
        element.style.setProperty('--tilt-x', `${(-y * 9.375).toFixed(2)}deg`)
        element.style.setProperty('--tilt-y', `${(x * 12.5).toFixed(2)}deg`)
      })
    }
    addEventListener('pointermove', move, { passive: true })
    return () => { cancelAnimationFrame(frame); removeEventListener('pointermove', move) }
  }, [])
  return <div className="phone-wrap" aria-hidden="true" ref={wrap}>
    <div className="phone-tilt"><div className="phone">
      <div className="phone-notch" />
      <div className="phone-screen">
        <div className="phone-top"><span className="phone-avatar">👁️</span><span><b>{t('Wallet {number}', { number: 1 })}</b><small>Mainnet</small></span></div>
        <div className="phone-balance">$24,680<span>.42</span></div>
        <div className="phone-change"><span>+$1,135.70</span><i>+4.82%</i></div>
        <div className="phone-actions">
          <span><QrCode size={15} />{t('Receive')}</span><span><ArrowUp size={15} />{t('Send')}</span><span><Shuffle size={15} />{t('Swap')}</span><span><RefreshCw size={14} />{t('Refresh')}</span>
        </div>
        <div className="phone-tokens">
          {([['ethereum', 'Ethereum', '6.32 ETH', '$15,836'], ['solana', 'Solana', '48 SOL', '$5,952'], ['base', 'Base', '1.15 ETH', '$2,891']] as const).map(([chain, name, amount, usd]) => <div key={chain}>
            <Coin chain={chain} /><span><b>{name}</b><small>{amount}</small></span><strong>{usd}</strong>
          </div>)}
        </div>
      </div>
    </div></div>
    <div className="float-card float-card--one hover-card"><ShieldCheck size={18} /><span><b>{t('Vault locked')}</b><small>{t('Encrypted on device')}</small></span></div>
    <div className="float-card float-card--two hover-card"><span className="float-dot" /><span><b>{t('Sent {amount}', { amount: '0.25 ETH' })}</b><small>{t('Confirmed')}</small></span></div>
  </div>
}

type MarketCoin = { id: string; name: string; symbol: string; price: number; change: number; rank: number; points: number[] }
const changeOver = (points: number[]) => (points[points.length - 1] - points[0]) / points[0] * 100
type MarketEntry = { id?: unknown; name?: unknown; symbol?: unknown; current_price?: unknown; price_change_percentage_24h?: unknown; market_cap_rank?: unknown; sparkline_in_7d?: { price?: unknown } }
const stable = new Set(['usd-coin', 'tether', 'dai'])
/** The landing page keeps its original coin list, newer wallet coins stay in the app. */
const landingCoins = new Set(['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'hyperliquid', 'monero', 'usd-coin', 'tether', 'chainlink', 'dai'])

/** Market row: every supported coin with its 7d line, price and 24h change. */
function MarketSection({ action, openWallet }: { action: string; openWallet: () => void }) {
  const [coins, setCoins] = useState<MarketCoin[]>()
  const [tab, setTab] = useState<'top' | 'movers'>('top')
  const stage = useRef<HTMLDivElement>(null)
  const glide = useRef(0)
  // Card index the arrows are heading to, null when the row is at rest.
  const target = useRef<number | null>(null)
  const fading = useRef<Animation>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/market/sparklines?currency=usd', { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((response) => response.ok ? response.json() as Promise<MarketEntry[]> : Promise.reject(new Error('Market data unavailable')))
      .then((data) => {
        if (!Array.isArray(data)) throw new Error('Market data unavailable')
        const week: MarketCoin[] = data.flatMap((entry) => {
          const raw = entry.sparkline_in_7d?.price
          const points = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : []
          if (typeof entry.id !== 'string' || !landingCoins.has(entry.id) || typeof entry.current_price !== 'number' || points.length < 2) return []
          return [{
            id: entry.id, name: String(entry.name ?? entry.id), symbol: String(entry.symbol ?? '').toUpperCase(), price: entry.current_price,
            change: changeOver(points), rank: Number(entry.market_cap_rank) || 9999, points,
          }]
        })
        // Line and % both cover 7d.
        setCoins(week)
      })
      .catch(() => { if (!controller.signal.aborted) setCoins([]) })
    return () => controller.abort()
  }, [])

  const list = (coins ?? []).filter((coin) => tab === 'top' || !stable.has(coin.id))
    .sort((a, b) => tab === 'top' ? a.rank - b.rank : Math.abs(b.change) - Math.abs(a.change))
  // Tab switch: the row fades out, then the new tab's row (keyed by tab) fades in from the start with every line drawing at once.
  const switchTab = (next: 'top' | 'movers') => {
    const row = stage.current?.querySelector<HTMLElement>('.market-row')
    if (next === tab || !row || fading.current) return
    cancelAnimationFrame(glide.current)
    target.current = null
    fading.current = row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' })
    fading.current.finished.then(() => { fading.current = undefined; setTab(next) }, () => { fading.current = undefined })
  }
  // Arrows: a press while gliding retargets from where the row is headed, so fast clicks keep moving without snapping back.
  const scroll = (direction: number) => {
    const row = stage.current?.querySelector<HTMLElement>('.market-row')
    const cards = row ? [...row.querySelectorAll<HTMLElement>('.market-card')] : []
    if (!row || cards.length < 2 || fading.current) return
    // Exact snap positions so turning snapping back on never shifts a pixel.
    const base = row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).scrollPaddingLeft) - row.scrollLeft
    const max = row.scrollWidth - row.clientWidth
    const stops = cards.map((card) => Math.max(0, Math.min(max, card.getBoundingClientRect().left - base)))
    const from = row.scrollLeft
    const index = target.current ?? stops.reduce((best, stop, at) => Math.abs(stop - from) < Math.abs(stops[best] - from) ? at : best, 0)
    // Past the end every stop is clamped to max: step to the next distinct one.
    let next = index
    while (next + direction >= 0 && next + direction < stops.length && Math.abs(stops[next + direction] - stops[index]) < 1) next += direction
    next = Math.max(0, Math.min(stops.length - 1, next + direction))
    const to = stops[next]
    if (Math.abs(to - stops[index]) < 1) {
      // At the end: nudge and spring back (only once the row is at rest).
      if (target.current !== null) return
      const push = direction * 12
      row.animate([{ transform: 'none' }, { transform: `translateX(${-push}px)` }, { transform: `translateX(${push * .4}px)` }, { transform: `translateX(${-push * .15}px)` }, { transform: 'none' }], { duration: 320, easing: 'ease-out' })
      return
    }
    target.current = next
    cancelAnimationFrame(glide.current)
    row.style.scrollSnapType = 'none'
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 360)
      // Ease-out, no overshoot.
      row.scrollLeft = from + (to - from) * (1 - (1 - t) ** 5)
      if (t < 1) glide.current = requestAnimationFrame(tick)
      else { row.style.scrollSnapType = ''; target.current = null }
    }
    glide.current = requestAnimationFrame(tick)
  }


  return <section className="landing-section landing-container market" aria-labelledby="market-title">
    <div className="section-head reveal">
      <h2 id="market-title">{t('Watch the market.')}</h2>
      <span className="eyebrow">{t('Live prices')}</span>
      <p className="market-intro">{t('Every token Still supports, with live prices, 24h moves and charts from a day to a year, right next to your balances.')}</p>
    </div>
    <div className="market-bar reveal">
      <div className="market-tabs" role="group" aria-label={t('Sort tokens')} style={{ '--i': tab === 'top' ? 0 : 1 } as CSSProperties}>
        <span aria-hidden="true" />
        <button type="button" aria-pressed={tab === 'top'} onClick={() => switchTab('top')}>{t('Top tokens')}</button>
        <button type="button" aria-pressed={tab === 'movers'} onClick={() => switchTab('movers')}>{t('Top movers')}</button>
      </div>
      <div className="market-arrows">
        <button type="button" aria-label={t('Scroll back')} onClick={() => scroll(-1)}><ArrowLeft size={18} /></button>
        <button type="button" aria-label={t('Scroll forward')} onClick={() => scroll(1)}><ArrowRight size={18} /></button>
      </div>
    </div>
    <div ref={stage} className="market-stage reveal"><div key={tab} className="market-row" role="list">
      {coins === undefined ? Array.from({ length: 4 }, (_, index) => <div key={index} className="market-card market-card--loading" role="listitem" />)
        : list.length === 0 ? <p className="market-empty">{t('Prices are unavailable right now.')}</p>
        : list.map((coin, index) => {
          const network = Object.values(networks).find((entry) => entry.priceId === coin.id)
          const token = network ? undefined : tokens.find((entry) => entry.priceId === coin.id)
          const up = coin.change >= 0
          const priceText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: coin.price < 1 ? 4 : 2 }).format(coin.price)
          const changeText = `${up ? '+' : '−'}${Math.abs(coin.change).toFixed(2)}%`
          return <article key={index} className="market-card hover-card" role="listitem">
            <header><CrossFade id={coin.id} ms={250}>{network ? <Coin chain={network.chain} /> : token ? <TokenIcon token={token} /> : null}</CrossFade><span><strong><CrossFade id={coin.name} ms={250}>{coin.name}</CrossFade></strong><small><CrossFade id={coin.symbol} ms={250}>{coin.symbol}</CrossFade></small></span></header>
            <CrossFade id={coin.id} ms={250}><MorphLine points={coin.points} up={up} label={t('{name} price over 7 days', { name: coin.name })} /></CrossFade>
            <footer>
              <strong><CrossFade id={priceText} ms={250}>{priceText}</CrossFade></strong>
              <small className={up ? 'up' : 'down'}><CrossFade id={changeText} ms={250}>{changeText}</CrossFade> <span className="market-range">7D</span></small>
            </footer>
          </article>
        })}
    </div></div>
    <div className="market-cta-wrap reveal"><button className="button secondary landing-button market-cta" type="button" onClick={openWallet}>{action}<ArrowRight size={17} /></button></div>
  </section>
}

