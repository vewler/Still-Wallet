import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, Globe2, KeyRound, LockKeyhole, QrCode, RefreshCw, ShieldCheck, Shuffle, Timer, Wallet, WifiOff } from 'lucide-react'
import { Brand, Coin, TokenIcon } from './Icons'
import { CrossFade, MorphLine } from './Charts'
import { networks } from '../networks'
import { tokens } from '../tokens'
import { smoothScrollTo } from '../scroll'
import './landing.css'

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
  const action = mode === 'none' ? 'Get started' : mode === 'locked' ? 'Unlock wallet' : 'Open wallet'
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

  // Sticky hero: pin it where its bottom meets the screen bottom (or under the header if it fits).
  useEffect(() => {
    const hero = root.current?.querySelector<HTMLElement>('.landing-hero')
    const header = root.current?.querySelector<HTMLElement>('.landing-header')
    if (!hero || !header) return
    const place = () => hero.style.setProperty('--hero-top', `${Math.min(header.offsetHeight, window.innerHeight - hero.offsetHeight)}px`)
    place()
    const observer = new ResizeObserver(place)
    observer.observe(hero)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
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
        <a className="landing-brand" href="#welcome" aria-label="Still home" onClick={(event) => { if (['/', '/welcome', '/about'].includes(location.pathname)) { event.preventDefault(); navTarget.current = null; smoothScrollTo(0) } }}><Brand attribution /></a>
        <nav aria-label="Site" className="landing-nav">
          <a className="landing-nav-link" aria-current={active === 'features' ? 'true' : undefined} href="#features" onClick={scrollToSection('features')}>Features</a>
          <a className="landing-nav-link" aria-current={active === 'security-section' ? 'true' : undefined} href="#security-section" onClick={scrollToSection('security-section')}>Security</a>
          <a className="landing-nav-link" aria-current={active === 'about' ? 'true' : undefined} href="#about" onClick={scrollToSection('about')}>About</a>
          <button className="button primary landing-button" type="button" onClick={openWallet}>{action}</button>
        </nav>
      </div>
    </header>

    <main id="main-content" ref={mainRef} tabIndex={-1} className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="landing-container landing-hero-inner">
          <div className="landing-copy">
            <h1 id="landing-title">Crypto<br /><span className="gradient-text">kept still.</span></h1>
            <p>A calm, private wallet for Bitcoin, Ethereum, Solana and more. Your recovery phrase never leaves your device.</p>
            <div className="landing-actions">
              <button className="button primary landing-button landing-button--big" type="button" onClick={openWallet}>{action}<ArrowRight size={19} /></button>
            </div>
            <ul className="hero-points">
              <li><ShieldCheck size={16} /> No account or email</li>
              <li><LockKeyhole size={16} /> Encrypted on device</li>
              <li><Globe2 size={16} /> Open source</li>
            </ul>
          </div>
          <PhoneMockup />
        </div>
      </section>

      <section className="landing-chains reveal" aria-label="Supported networks">
        <div className="landing-container chains-inner">
          <span>Works with</span>
          <div className="chain-logos">
            <span><Coin chain="bitcoin" /> Bitcoin</span>
            <span><Coin chain="ethereum" /> Ethereum</span>
            <span><Coin chain="solana" /> Solana</span>
            <span><Coin chain="bnb" /> BNB Chain</span>
            <span><Coin chain="xrp" /> XRP Ledger</span>
            <span><Coin chain="hyperevm" /> HyperEVM</span>
            <span><Coin chain="base" /> Base</span>
              <span><Coin chain="monero" /> Monero</span>
          </div>
        </div>
      </section>

      <section id="features" tabIndex={-1} className="landing-section landing-container" aria-labelledby="features-title">
        <div className="section-head reveal">
          <h2 id="features-title">Small on purpose.<br /><span className="muted-text">Eight chains, one phrase.</span></h2>
          <span className="eyebrow">Features</span>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text }, index) => <article key={title} className="feature-card hover-card reveal" style={{ '--d': `${(index % 3) * 70}ms` } as CSSProperties}>
            <span className="feature-icon"><Icon size={22} /></span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>)}
        </div>
      </section>

      <section id="security-section" tabIndex={-1} className="landing-security" aria-labelledby="security-title">
        <div className="landing-container security-inner">
          <div className="reveal">
            <h2 id="security-title">Your phrase stays encrypted.</h2>
            <span className="eyebrow">Security</span>
            <p>Still encrypts your recovery phrase with your password right in the browser. Nobody at ow2 can see it, reset it or move your funds. Still hasn’t had an independent audit yet, so start small on mainnet.</p>
          </div>
          <dl className="security-stats">
            {security.map(([value, label], index) => <div key={label} className="hover-card reveal" style={{ '--d': `${index * 70}ms` } as CSSProperties}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </div>
      </section>

      <section className="landing-section landing-container" aria-labelledby="steps-title">
        <div className="section-head reveal">
          <h2 id="steps-title">Set up in a minute.</h2>
          <span className="eyebrow">Get going</span>
        </div>
        <ol className="steps">
          {[['Create or import', 'Make a new recovery phrase or bring your own.'], ['Back it up', 'Write the words down. They’re the only way back in.'], ['Send and receive', 'Pick a network, scan a QR code and you’re done.']].map(([title, text], index) => <li key={title} className="hover-card reveal" style={{ '--d': `${index * 80}ms` } as CSSProperties}>
            <span className="step-number">{index + 1}</span><h3>{title}</h3><p>{text}</p>
          </li>)}
        </ol>
      </section>

      <MarketSection action={action} openWallet={openWallet} />

      <section className="landing-cta reveal" aria-labelledby="cta-title">
        <div className="landing-container cta-inner">
          <h2 id="cta-title">Ready to hold your own keys?</h2>
          <button className="button primary landing-button landing-button--big" type="button" onClick={openWallet}>{action}<ArrowRight size={19} /></button>
        </div>
      </section>

      <section id="about" className="landing-about landing-container reveal" aria-labelledby="about-title" tabIndex={-1}>
        <h2 id="about-title">About ow2</h2>
        <div>
          <p>ow2 created Still as an open-source wallet for people who want to hold their own keys and choose how they connect to a network.</p>
          <a className="landing-community" href={discord} target="_blank" rel="noreferrer">Join the Discord <ArrowRight size={18} /></a>
        </div>
      </section>

    </main>

    <footer className="landing-footer landing-container">
      <span><strong>Still</strong> by ow2 <small className="landing-build">build {import.meta.env.VITE_BUILD}</small></span>
      <span className="landing-footer-links"><a href="#faq">FAQ</a><a href="#credits">Credits</a><a href="#privacy">Privacy Policy</a><a href="/LICENSE.txt" target="_blank" rel="noreferrer">MIT License</a></span>
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
        element.style.setProperty('--tilt-x', `${(-y * 7.5).toFixed(2)}deg`)
        element.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`)
      })
    }
    addEventListener('pointermove', move, { passive: true })
    return () => { cancelAnimationFrame(frame); removeEventListener('pointermove', move) }
  }, [])
  return <div className="phone-wrap" aria-hidden="true" ref={wrap}>
    <div className="phone-tilt"><div className="phone">
      <div className="phone-notch" />
      <div className="phone-screen">
        <div className="phone-top"><span className="phone-avatar">👁️</span><span><b>Wallet 1</b><small>Mainnet</small></span></div>
        <div className="phone-balance">$24,680<span>.42</span></div>
        <div className="phone-change"><span>+$1,135.70</span><i>+4.82%</i></div>
        <div className="phone-actions">
          <span><QrCode size={15} />Receive</span><span><ArrowUp size={15} />Send</span><span><Shuffle size={15} />Swap</span><span><RefreshCw size={14} />Refresh</span>
        </div>
        <div className="phone-tokens">
          {([['ethereum', 'Ethereum', '6.32 ETH', '$15,836'], ['solana', 'Solana', '48 SOL', '$5,952'], ['base', 'Base', '1.15 ETH', '$2,891']] as const).map(([chain, name, amount, usd]) => <div key={chain}>
            <Coin chain={chain} /><span><b>{name}</b><small>{amount}</small></span><strong>{usd}</strong>
          </div>)}
        </div>
      </div>
    </div></div>
    <div className="float-card float-card--one hover-card"><ShieldCheck size={18} /><span><b>Vault locked</b><small>Encrypted on device</small></span></div>
    <div className="float-card float-card--two hover-card"><span className="float-dot" /><span><b>Sent 0.25 ETH</b><small>Confirmed</small></span></div>
  </div>
}

type MarketCoin = { id: string; name: string; symbol: string; price: number; change: number; rank: number; points: number[] }
const changeOver = (points: number[]) => (points[points.length - 1] - points[0]) / points[0] * 100
type MarketEntry = { id?: unknown; name?: unknown; symbol?: unknown; current_price?: unknown; price_change_percentage_24h?: unknown; market_cap_rank?: unknown; sparkline_in_7d?: { price?: unknown } }
const stable = new Set(['usd-coin', 'tether', 'dai'])

/** Market row: every supported coin with its 7d line, price and 24h change. */
function MarketSection({ action, openWallet }: { action: string; openWallet: () => void }) {
  const [coins, setCoins] = useState<MarketCoin[]>()
  const [tab, setTab] = useState<'top' | 'movers'>('top')
  // Draw-in only on the first reveal, after that lines crossfade.
  const [swapped, setSwapped] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const glide = useRef(0)
  const gliding = useRef(false)
  const progress = useRef(0)
  const queued = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/market/sparklines?currency=usd', { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((response) => response.ok ? response.json() as Promise<MarketEntry[]> : Promise.reject(new Error('Market data unavailable')))
      .then((data) => {
        if (!Array.isArray(data)) throw new Error('Market data unavailable')
        const week: MarketCoin[] = data.flatMap((entry) => {
          const raw = entry.sparkline_in_7d?.price
          const points = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : []
          if (typeof entry.id !== 'string' || typeof entry.current_price !== 'number' || points.length < 2) return []
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
  // Visible row = newest one in the crossfade.
  const scroll = (direction: number) => {
    const rows = stage.current?.querySelectorAll<HTMLElement>('.market-row')
    const row = rows?.[rows.length - 1]
    const cards = row ? [...row.querySelectorAll<HTMLElement>('.market-card')] : []
    if (!row || cards.length < 2) return
    // From 65% of a slide on, buffer one press and play it right after. Earlier presses are ignored.
    if (gliding.current) { if (progress.current >= .65 && !queued.current) queued.current = direction; return }
    // Exact snap positions so turning snapping back on never shifts a pixel.
    const base = row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).scrollPaddingLeft) - row.scrollLeft
    const stops = cards.map((card) => card.getBoundingClientRect().left - base)
    const max = row.scrollWidth - row.clientWidth
    const current = row.scrollLeft
    const index = stops.reduce((best, stop, at) => Math.abs(stop - current) < Math.abs(stops[best] - current) ? at : best, 0)
    const to = Math.max(0, Math.min(max, stops[Math.max(0, Math.min(stops.length - 1, index + direction))]))
    const from = row.scrollLeft
    // At the end: nudge and spring back.
    if (Math.abs(to - from) < 1) {
      const push = direction * 12
      row.animate([{ transform: 'none' }, { transform: `translateX(${-push}px)` }, { transform: `translateX(${push * .4}px)` }, { transform: `translateX(${-push * .15}px)` }, { transform: 'none' }], { duration: 320, easing: 'ease-out' })
      return
    }
    cancelAnimationFrame(glide.current)
    row.style.scrollSnapType = 'none'
    gliding.current = true
    progress.current = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 360)
      progress.current = t
      // Ease-out, no overshoot.
      row.scrollLeft = from + (to - from) * (1 - (1 - t) ** 5)
      if (t < 1) glide.current = requestAnimationFrame(tick)
      else {
        row.style.scrollSnapType = ''
        gliding.current = false
        const next = queued.current
        queued.current = 0
        if (next) scroll(next)
      }
    }
    glide.current = requestAnimationFrame(tick)
  }


  return <section className="landing-section landing-container market" aria-labelledby="market-title">
    <div className="section-head reveal">
      <h2 id="market-title">Watch the market.</h2>
      <span className="eyebrow">Live prices</span>
      <p className="market-intro">Every token Still supports, with live prices, 24h moves and charts from a day to a year, right next to your balances.</p>
    </div>
    <div className="market-bar reveal">
      <div className="market-tabs" role="group" aria-label="Sort tokens" style={{ '--i': tab === 'top' ? 0 : 1 } as CSSProperties}>
        <span aria-hidden="true" />
        <button type="button" aria-pressed={tab === 'top'} onClick={() => { setTab('top'); setSwapped(true) }}>Top tokens</button>
        <button type="button" aria-pressed={tab === 'movers'} onClick={() => { setTab('movers'); setSwapped(true) }}>Top movers</button>
      </div>
      <div className="market-arrows">
        <button type="button" aria-label="Scroll back" onClick={() => scroll(-1)}><ArrowLeft size={18} /></button>
        <button type="button" aria-label="Scroll forward" onClick={() => scroll(1)}><ArrowRight size={18} /></button>
      </div>
    </div>
    <div ref={stage} className="market-stage reveal" data-swapped={swapped || undefined}><div className="market-row" role="list">
      {coins === undefined ? Array.from({ length: 4 }, (_, index) => <div key={index} className="market-card market-card--loading" role="listitem" />)
        : list.length === 0 ? <p className="market-empty">Prices are unavailable right now.</p>
        : list.map((coin, index) => {
          const network = Object.values(networks).find((entry) => entry.priceId === coin.id)
          const token = network ? undefined : tokens.find((entry) => entry.priceId === coin.id)
          const up = coin.change >= 0
          const priceText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: coin.price < 1 ? 4 : 2 }).format(coin.price)
          const changeText = `${up ? '+' : '−'}${Math.abs(coin.change).toFixed(2)}%`
          // Card stays put; icon, name and ticker crossfade like the line, price and %.
          return <article key={index} className="market-card hover-card" role="listitem">
            <header><CrossFade id={coin.id} ms={250}>{network ? <Coin chain={network.chain} /> : token ? <TokenIcon token={token} /> : null}</CrossFade><span><strong><CrossFade id={coin.name} ms={250}>{coin.name}</CrossFade></strong><small><CrossFade id={coin.symbol} ms={250}>{coin.symbol}</CrossFade></small></span></header>
            <CrossFade id={coin.id} ms={250}><MorphLine points={coin.points} up={up} label={`${coin.name} price over 7 days`} /></CrossFade>
            <footer>
              <strong><CrossFade id={priceText} ms={250}>{priceText}</CrossFade></strong>
              <small className={up ? 'up' : 'down'}><CrossFade id={changeText} ms={250}>{changeText}</CrossFade> <span className="market-range">7D</span></small>
            </footer>
          </article>
        })}
    </div></div>
    <div className="market-cta-wrap reveal"><button className="button secondary landing-button market-cta" type="button" onClick={openWallet}>{action === 'Get started' ? 'Watch it in Still' : action}<ArrowRight size={17} /></button></div>
  </section>
}

