import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react'
import { Activity, ArrowLeft, ExternalLink, Info, ChartLine, ArrowRight, Check, ChevronDown, Download, Eye, EyeOff, House, Layers3, LoaderCircle, LockKeyhole, Pencil, Plus, ScanFace, Settings, ShieldAlert, WifiOff, X } from 'lucide-react'
import { Brand } from './components/Icons'
import { passwordRules } from './passwords'
import { registerSW } from 'virtual:pwa-register'
import { activeNetworks, defaultEndpoint, formatAmount, networks, type NetworkId } from './networks'
import { tokenById } from './tokens'
import { failedUnlocks, forgetVault, maxUnlockAttempts, normalizeWalletName, saveFailedUnlocks, savedVaultId } from './storage'
import { EmojiPicker } from './components/EmojiPicker'
import { Contacts } from './components/Contacts'
import type { Session } from './vault'
import { disablePasskey, enablePasskey, passkeyDevice, passkeyOn, unlockWithPasskey, type PasskeySetup } from './passkey'
import { Overview } from './components/Overview'
import { ActivityPage, NetworksPage, RpcDialog, SettingsPage } from './components/Pages'
import { ChartsPage, prefetchCharts } from './components/Charts'
import { Landing, discord } from './components/Landing'
import { credits, dataSources, supporters, team } from './credits'
import { ManageCoins } from './components/Manage'
import { smoothScrollTo } from './scroll'
import { CreditsPage, ErrorPage, FaqPage, PrivacyPolicy } from './components/Privacy'
import { Dialog, ErrorSlot, Notice, PasswordInput } from './components/Dialog'
import { useWallet } from './useWallet'
import { PullRefresh } from './components/PullRefresh'
import { ConnectedApps, DappPrompts, useDapps } from './components/Dapps'

// Sheets are tiny, so bundle them up front. No loader flash on open.
import { Access } from './components/Access'
import { RecoveryPhrase } from './components/RecoveryPhrase'
import { AssetDetails, Receive, Scramble, Send, Swap } from './components/Transfer'
import { t, useLanguage } from './i18n'

const navigation = [
  { id: 'overview', label: 'Home', icon: House },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'charts', label: 'Charts', icon: ChartLine },
  { id: 'networks', label: 'Networks', icon: Layers3 },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const
const tabs: string[] = navigation.filter(({ id }) => id !== 'networks').map(({ id }) => id)

type Route = typeof navigation[number]['id'] | 'home' | 'landing' | 'about' | 'privacy' | 'credits' | 'faq' | 'notfound'
const sheetKeys = new WeakMap<object, number>()
let sheetCount = 0
const sheetKey = (modal: object) => { if (!sheetKeys.has(modal)) sheetKeys.set(modal, ++sheetCount); return sheetKeys.get(modal)! }

type Modal =
  | { type: 'access'; intent?: 'send' | 'receive' | 'swap'; network?: NetworkId; token?: string }
  | { type: 'receive' | 'send' | 'asset'; network?: NetworkId; token?: string }
  | { type: 'rpc'; network: NetworkId }
  | { type: 'swap'; network?: NetworkId; token?: string }
  | { type: 'scramble'; network: NetworkId; token?: string }
  | { type: 'manage' | 'credits' | 'protect' | 'remove' | 'offline' | 'rename' | 'wallets' | 'contacts' | 'passkey' | 'password' | 'phrase' }
  | { type: 'leave'; to: 'about' | 'discord' }
  | { type: 'dapps'; link?: string }


// Clean paths (/activity). Old #links get rewritten on load. / is always the landing page, the wallet lives at /wallet.
const pages = ['about', 'privacy', 'credits', 'faq']
const isRoute = (name: string) => pages.includes(name) || navigation.some(({ id }) => id === name)
const pathOf = (name: string) => name === '' ? '/' : name === 'overview' ? '/wallet' : `/${name}`
function currentRoute(): Route {
  const name = location.pathname.slice(1).replace(/\/+$/, '')
  if (name === 'about' || name === 'privacy' || name === 'credits' || name === 'faq') return name
  if (name === '' || name === 'index.html') return 'landing'
  if (name === 'wallet') return 'home'
  return navigation.find(({ id }) => id === name && id !== 'overview')?.id ?? 'notfound'
}
// Per-page title, description and canonical for search. Home keeps what index.html ships.
const homeMeta = { title: document.title, description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '' }
const pageMeta: Partial<Record<Route, { title: string; description: string; path: string }>> = {
  landing: { ...homeMeta, path: '/' },
  about: { ...homeMeta, path: '/' },
  privacy: { title: 'Privacy Policy · Still Wallet', description: 'Still Wallet has no sign-up, analytics or trackers. Your wallet data stays on your device.', path: '/privacy' },
  credits: { title: 'Credits · Still Wallet', description: 'The people and open-source projects behind Still Wallet.', path: '/credits' },
  faq: { title: 'FAQ · Still Wallet', description: 'Answers to common questions about Still Wallet, a self-custody crypto wallet.', path: '/faq' },
}
function applyMeta(route: Route) {
  const meta = pageMeta[route]
  document.title = meta ? t(meta.title) : homeMeta.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta ? t(meta.description) : homeMeta.description)
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://stillwallet.net${meta?.path ?? '/'}`)
  // Wallet screens are not for search results.
  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (meta) robots?.remove()
  else if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.append(robots) }
}
function adoptHash() {
  const name = location.hash.slice(1)
  if (isRoute(name)) history.replaceState(null, '', pathOf(name))
}
adoptHash()
// Home screen app opens straight into the wallet, even if it was installed back when / was the wallet.
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
if (standalone && location.pathname === '/') history.replaceState(null, '', '/wallet' + location.search)
// Apps open the wallet with a WalletConnect link (stillwallet.net/wallet?uri=wc:…). Held until unlock, kept out of the address bar.
let pendingLink = ''
{
  const search = new URLSearchParams(location.search)
  const link = search.get('uri') ?? search.get('wc') ?? ''
  if (link.startsWith('wc:')) {
    pendingLink = link
    search.delete('uri'); search.delete('wc')
    history.replaceState(null, '', location.pathname + (search.size ? `?${search}` : ''))
  }
}

export function go(name: string) {
  history.pushState(null, '', pathOf(name))
  dispatchEvent(new Event('routechange'))
}

export default function App() {
  const language = useLanguage()
  const [route, setRoute] = useState(currentRoute)
  const [modal, setModal] = useState<Modal>()
  const [toast, setToast] = useState('')
  const [updateReady, setUpdateReady] = useState(false)
  const updateWorker = useRef<ReturnType<typeof registerSW> | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const content = useRef<HTMLElement>(null)
  const close = useCallback(() => setModal(undefined), [])
  // Same slide-down as the X button.
  const closeSheet = useCallback(() => {
    const sheets = document.querySelectorAll('dialog[open]')
    const top = sheets[sheets.length - 1]
    if (!top) { close(); return }
    if (top.classList.contains('dialog--closing')) return
    top.classList.add('dialog--closing')
    window.setTimeout(close, 280)
  }, [close])
  // Sheet to sheet: the new one slides up over the old, the old one slides out behind it.
  const [under, setUnder] = useState<{ modal: Modal; fading: boolean }>()
  const [current, setCurrent] = useState(modal)
  if (modal !== current) {
    setCurrent(modal)
    setUnder(current && modal ? { modal: current, fading: false } : undefined)
  }
  useEffect(() => {
    if (!under || under.fading) return
    const fade = window.setTimeout(() => setUnder({ ...under, fading: true }), 280)
    return () => window.clearTimeout(fade)
  }, [under])
  useEffect(() => {
    if (!under?.fading) return
    const done = window.setTimeout(() => setUnder(undefined), 240)
    return () => window.clearTimeout(done)
  }, [under])
  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 4200)
  }, [])
  const wallet = useWallet(close, notify)
  const dapps = useDapps(wallet.mode === 'wallet' && !wallet.preferences.offline)
  // A pull-to-refresh only grays the Refresh button (the pull arrow spins). Cleared a bit after loading so the fade back matches.
  const [pulled, setPulled] = useState(false)
  useEffect(() => {
    if (wallet.refreshing || !pulled) return
    const timer = window.setTimeout(() => setPulled(false), 250)
    return () => window.clearTimeout(timer)
  }, [wallet.refreshing, pulled])
  const { preferences, mode, session } = wallet
  const [passkey, setPasskey] = useState(passkeyOn)
  useEffect(() => { setPasskey(passkeyOn()) }, [mode])
  const displayedNetworks = activeNetworks(preferences.environment)
  // Crossed-out wifi in the header while requests are paused, tap to resume. Kept briefly after so it can fade out.
  const [pauseIcon, setPauseIcon] = useState(preferences.offline)
  useEffect(() => {
    if (preferences.offline) { setPauseIcon(true); return }
    const timer = window.setTimeout(() => setPauseIcon(false), 200)
    return () => window.clearTimeout(timer)
  }, [preferences.offline])
  const landing = route === 'about' || route === 'landing'
  useEffect(() => applyMeta(route), [route, language])
  const page = route === 'home' ? 'overview' : route

  useEffect(() => {
    const onRoute = () => {
      // Old page is still mounted here, save its scroll.
      scrolls.current.set(scrollKey(shownRoute.current), window.scrollY)
      setRoute(currentRoute())
      close()
    }
    const onHash = () => { if (isRoute(location.hash.slice(1))) { adoptHash(); onRoute() } }
    // In-app #links become path changes.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const href = (event.target as Element).closest?.('a[href^="#"], a[href="/"]')?.getAttribute('href')
      if (!href) return
      const name = href === '/' ? '' : href.slice(1)
      if (name && !isRoute(name)) return
      event.preventDefault()
      go(name)
    }
    addEventListener('hashchange', onHash)
    addEventListener('popstate', onRoute)
    addEventListener('routechange', onRoute)
    document.addEventListener('click', onClick)
    if (import.meta.env.PROD) updateWorker.current = registerSW()
    // A new SW takes over on download but only shows on next launch. No auto reload, it would close the phone keyboard. The wallet has an Update button.
    const hadWorker = !!navigator.serviceWorker?.controller
    const onTakeover = () => { if (hadWorker) setUpdateReady(true) }
    navigator.serviceWorker?.addEventListener('controllerchange', onTakeover)
    return () => {
      removeEventListener('hashchange', onHash)
      removeEventListener('popstate', onRoute)
      removeEventListener('routechange', onRoute)
      document.removeEventListener('click', onClick)
      clearTimeout(toastTimer.current)
    }
  }, [close, notify])

  // Back from Privacy/Credits/FAQ restores the scroll position.
  const scrolls = useRef(new Map<string, number>())
  // / and #about share one saved position.
  const scrollKey = (value: Route) => value === 'about' || value === 'landing' ? 'landing' : value
  const shownRoute = useRef(route)
  const restored = useRef(false)
  useLayoutEffect(() => {
    const from = shownRoute.current
    shownRoute.current = route
    const saved = scrolls.current.get(scrollKey(route))
    if ((from === 'privacy' || from === 'credits' || from === 'faq') && saved !== undefined) {
      window.scrollTo(0, saved)
      content.current?.focus({ preventScroll: true })
      restored.current = true
    }
  }, [route])

  useEffect(() => {
    if (restored.current) { restored.current = false; return }
    if (route === 'about') {
      const about = document.getElementById('about')
      about?.focus({ preventScroll: true })
      // Wait a frame for layout, then glide.
      if (about) requestAnimationFrame(() => smoothScrollTo(about))
    } else if (route !== 'home') {
      window.scrollTo(0, 0)
      content.current?.focus({ preventScroll: true })
    }
  }, [route])

  // Preload the crypto chunk after first paint so Create/Unlock/Send/Receive/Charts never wait on it.
  useEffect(() => {
    const warm = () => {
      void import('./vault')
      void import('./rpc')
      void import('qrcode')
    }
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 600))
    const handle = idle(warm)
    return () => { if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle) }
  }, [])

  // Prefetch every chart range while idle.
  useEffect(() => {
    if (preferences.offline) return
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1500))
    const handle = idle(() => void prefetchCharts(preferences.environment, preferences.currency))
    return () => { if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle) }
  }, [preferences.offline, preferences.environment, preferences.currency])

  function openWallet() {
    if (mode === 'wallet') go('overview')
    else setModal({ type: 'access' })
  }


  function openTransfer(action: 'send' | 'receive' | 'swap', network?: NetworkId, token?: string) {
    if (mode !== 'wallet') setModal({ type: 'access', intent: action, network, token })
    else if (action !== 'receive' && preferences.offline) setModal({ type: 'offline' })
    else setModal(action === 'swap' ? { type: 'swap', network, token } : { type: action, network, token })
  }

  // Unlock and new wallets always open on Home, not the last page.
  function toHome() {
    if (location.pathname !== '/wallet') history.replaceState(null, '', '/wallet')
    setRoute('home')
    window.scrollTo(0, 0)
  }

  function start(value: Session) {
    wallet.start(value)
    toHome()
    if (modal?.type === 'access' && modal.intent) {
      let network = modal.network
      if (network && !network.endsWith(`-${preferences.environment}`)) network = `${networks[network].chain}-${preferences.environment}`
      if (modal.intent !== 'receive' && preferences.offline) setModal({ type: 'offline' })
      else setModal(modal.intent === 'swap' ? { type: 'swap', network, token: modal.token } : { type: modal.intent, network, token: modal.token })
    } else if (pendingLink) {
      setModal({ type: 'dapps', link: pendingLink })
      pendingLink = ''
    } else {
      close()
    }
    notify('Wallet unlocked')
  }


  function lock() {
    wallet.lock()
    notify('Wallet locked')
  }

  function assetAmount(network: typeof networks[NetworkId]) {
    if (preferences.hide && mode !== 'locked') return '••••'
    const amount = wallet.balances[network.id]?.amount
    return amount === undefined ? undefined : `${formatAmount(amount, network.decimals)} ${network.symbol}`
  }

  function tokenAmount(id: string) {
    const token = tokenById(id)
    if (!token) return undefined
    if (preferences.hide && mode !== 'locked') return '••••'
    const amount = wallet.tokenBalances[id]?.amount
    return amount === undefined ? undefined : `${formatAmount(amount, token.decimals)} ${token.symbol}`
  }


  return <div className="shell">
    <a href="#main-content" className="skip-link" onClick={(event) => { event.preventDefault(); content.current?.focus() }}>{t('Skip to content')}</a>
    {route === 'notfound' ? <ErrorPage mainRef={content} kind="missing" /> : mode === 'none' && route !== 'home' && !landing && !pages.includes(route) ? <ErrorPage mainRef={content} kind="denied" /> : route === 'privacy' ? <PrivacyPolicy mainRef={content} back={mode === 'wallet' ? '#settings' : '/'} /> : route === 'credits' ? <CreditsPage mainRef={content} back={mode === 'wallet' ? '#settings' : '/'} /> : route === 'faq' ? <FaqPage mainRef={content} back={mode === 'wallet' ? '#settings' : '/'} /> : landing ? <Landing mode={mode} mainRef={content} openWallet={openWallet} /> : mode === 'locked' ? <LockScreen mainRef={content} protect={preferences.protect} preload={wallet.preload} onSession={start} removed={(message) => { wallet.removed(); notify(message) }} /> : <div className="app">
      <aside className="sidebar">
        <a href="#overview" className="sidebar-brand" aria-label={t('Still home')}><Brand /></a>
        <nav className="side-nav" aria-label={t('Wallet sections')}>
          {navigation.filter(({ id }) => id !== 'settings').map(({ id, label, icon: Icon }) => <a href={`#${id}`} aria-current={page === id ? 'page' : undefined} key={id}><Icon size={20} /><span>{t(label)}</span></a>)}
        </nav>
        <nav className="side-nav side-nav--bottom" aria-label={t('Settings')}>
          <a href="#settings" aria-current={page === 'settings' ? 'page' : undefined}><Settings size={20} /><span>{t('Settings')}</span></a>
        </nav>
      </aside>

      <div className="app-body">
      <header className="app-header">
        <button type="button" className="account" onClick={() => setModal({ type: mode === 'wallet' ? 'wallets' : 'access' })} aria-label={mode === 'wallet' ? t('{name}, switch or edit wallets', { name: wallet.name }) : t('Set up wallet')}>
          <span className="avatar">{mode === 'wallet' && wallet.emoji ? <span className="avatar-emoji" aria-hidden="true">{wallet.emoji}</span> : <img src="/icons/brand.svg" alt="" width="20" height="20" />}</span>
          <span className="account-text"><strong>{mode === 'none' ? t('No wallet') : wallet.name || t('Wallet')}{mode === 'wallet' && <ChevronDown size={14} className="account-edit" />}</strong>{mode === 'none' && <small>{t('Set up to start')}</small>}</span>
        </button>
        <div className="header-icons">
          {pauseIcon && <button className={preferences.offline ? 'round-button pause-button' : 'round-button pause-button leaving'} onClick={() => wallet.update({ offline: false })} aria-label={t('Network requests paused. Tap to turn them back on')} disabled={!preferences.offline}><WifiOff size={18} /></button>}
          <button className="round-button" onClick={() => wallet.update({ hide: !preferences.hide })} aria-label={preferences.hide ? t('Show balances') : t('Hide balances')}><span key={String(preferences.hide)} className="icon-swap">{preferences.hide ? <EyeOff size={19} /> : <Eye size={19} />}</span></button>
          {mode === 'wallet' ? <button className="round-button lock-button" onClick={(event) => {
            // Let the padlock close first.
            event.currentTarget.classList.add('locking')
            window.setTimeout(lock, 220)
          }} aria-label={t('Lock wallet')}><LockKeyhole size={18} /></button>
            : <button className="button primary pill" onClick={() => setModal({ type: 'access' })}>{t('Set up')}</button>}
        </div>
      </header>

      <main ref={content} id="main-content" className="app-main" tabIndex={-1}>
        <PullRefresh enabled={(page === 'overview' || page === 'activity') && mode === 'wallet' && !preferences.offline} refreshing={wallet.refreshing} refresh={() => { setPulled(true); void wallet.refresh(page === 'activity' ? 'activity' : 'balances') }} />
        {page === 'overview' && <Overview key={session?.id} mode={mode} preferences={preferences} balances={wallet.balances} refreshing={wallet.refreshing} pulled={pulled} refresh={() => void wallet.refresh('balances')} prices={wallet.prices} changes={wallet.changes} swap={() => openTransfer('swap')} scramble={() => setModal({ type: 'scramble', network: displayedNetworks[0].id })} setup={() => setModal({ type: 'access' })} openTransfer={(action, network) => openTransfer(action, network?.id)} openAsset={(network) => setModal({ type: 'asset', network: network.id })} tokenBalances={wallet.tokenBalances} openToken={(token) => setModal({ type: 'asset', network: token.network, token: token.id })} layout={wallet.layout} manage={() => setModal({ type: 'manage' })} />}
        {page === 'activity' && <ActivityPage mode={mode} items={wallet.items} hidden={preferences.hide} canRefresh={mode === 'wallet' && !preferences.offline} refreshing={wallet.refreshing} refresh={() => void wallet.refresh('activity')} />}
        {page === 'networks' && <NetworksPage preferences={preferences} edit={(network) => setModal({ type: 'rpc', network: network.id })} />}
        {page === 'charts' && <ChartsPage preferences={preferences} />}
        {page === 'settings' && <SettingsPage phrase={() => setModal({ type: 'phrase' })} contacts={wallet.contacts.length} openContacts={() => setModal({ type: 'contacts' })} leave={(to) => setModal({ type: 'leave', to })} name={wallet.name} rename={() => setModal({ type: 'rename' })} preferences={preferences} update={wallet.update} mode={mode} lock={lock} protect={() => preferences.protect ? wallet.update({ protect: false }) && notify('Account protection off') : setModal({ type: 'protect' })} setup={() => setModal({ type: 'access' })} remove={() => setModal({ type: 'remove' })} credits={() => setModal({ type: 'credits' })} apps={() => setModal({ type: 'dapps' })} appCount={dapps.sessions.length}
          passkey={mode === 'wallet' && passkeyDevice() ? passkey : undefined}
          togglePasskey={() => { if (passkey) { disablePasskey(); setPasskey(false); notify(t('Face ID unlock off')) } else setModal({ type: 'passkey' }) }}
          changePassword={() => setModal({ type: 'password' })} />}
      </main>
      </div>

      <nav className="tabbar" aria-label={t('Wallet navigation')}>
        <span className="tab-pill" aria-hidden="true" style={{ '--i': Math.max(0, tabs.indexOf(page)), opacity: tabs.includes(page) ? 1 : 0 } as CSSProperties} />
        {navigation.filter(({ id }) => id !== 'networks').map(({ id, label, icon: Icon }) => <a href={`#${id}`} aria-current={page === id ? 'page' : undefined} aria-label={t(label)} key={id}><Icon size={23} /><span>{t(label)}</span></a>)}
      </nav>
    </div>}

    {updateReady && <div className="update-banner button secondary" role="status"><Download size={16} /> {t('Reload to update Still')}</div>}
    <div className={`toast ${toast ? 'visible' : ''}${toast.endsWith('.') ? ' toast--warn' : ''}`} role="status">{toast && <>{toast.endsWith('.') ? <Info size={18} /> : <Check size={18} />}{t(toast)}</>}</div>

    {mode === 'wallet' && session && !preferences.offline && <DappPrompts prompts={dapps.prompts} wallet={{ session, name: wallet.name, prepareDapp: wallet.prepareDapp, withEndpoint: wallet.withEndpoint, submit: wallet.submit, notify }} />}
    {[under?.modal, modal].map((sheet) => sheet && <div key={sheetKey(sheet)} className={sheet === modal ? (under ? 'sheet-over' : undefined) : under?.fading ? 'sheet-under fading' : 'sheet-under'}>{renderSheet(sheet)}</div>)}
  </div>

  function renderSheet(modal: Modal) {
    const selected = 'network' in modal && modal.network ? networks[modal.network] : undefined
    const transferNetwork = selected && displayedNetworks.some((network) => network.id === selected.id) ? selected : undefined
    return <>
        {modal.type === 'access' && <Access locked={mode === 'locked'} intent={modal.intent} onSession={start} close={close} />}
        {modal.type === 'receive' && session && <Receive addresses={session.addresses} networks={displayedNetworks} initial={transferNetwork} initialAsset={modal.token} close={close} />}
        {modal.type === 'swap' && session && <Swap from={modal.network ? { network: modal.network, asset: modal.token ?? modal.network } : undefined} close={close} quote={wallet.prepareAnySwap} submit={wallet.submit} finished={() => { closeSheet(); go('activity') }} />}
        {modal.type === 'send' && session && <Send contacts={wallet.contacts} editContact={wallet.editContact} networks={displayedNetworks} initial={transferNetwork} initialAsset={modal.token} close={close} quote={wallet.prepare} submit={wallet.submit} finished={() => { closeSheet(); go('activity') }} />}
        {modal.type === 'asset' && selected && <AssetDetails network={selected} token={modal.token ? tokenById(modal.token) : undefined} amount={modal.token ? tokenAmount(modal.token) : assetAmount(selected)} noWallet={mode !== 'wallet'} close={close} send={(id) => openTransfer('send', id, modal.token)} receive={(id) => openTransfer('receive', id, modal.token)} swap={() => openTransfer('swap', selected.id, modal.token && tokenById(modal.token)?.user ? undefined : modal.token)} scramble={() => setModal({ type: 'scramble', network: selected.id, token: modal.token })} />}
        {modal.type === 'scramble' && <Scramble networks={displayedNetworks} initial={networks[modal.network]} initialAsset={modal.token ?? modal.network} close={close} />}
        {modal.type === 'rpc' && selected && <RpcDialog network={selected} current={preferences.rpc[selected.id]} offline={preferences.offline} close={close} save={(value) => {
          const rpc = { ...preferences.rpc }
          if (value) rpc[selected.id] = value
          else delete rpc[selected.id]
          if (wallet.update({ rpc })) { closeSheet(); notify(value ? 'Custom RPC saved' : 'Default RPC restored') }
        }} test={async (network, endpoint, signal) => (await import('./rpc')).testEndpoint(network, endpoint, signal)} />}
        {modal.type === 'manage' && session && <ManageCoins environment={preferences.environment} layout={wallet.layout} save={wallet.arrange} close={close} imports={{
          add: wallet.importToken, remove: wallet.removeToken,
          lookup: async (id, address, signal) => {
            if (preferences.offline) throw new Error('Turn on network requests to look up tokens.')
            const network = networks[id]
            return (await import('./discover')).lookupToken(network, preferences.rpc[id] ?? defaultEndpoint(network), address, signal)
          },
        }} />}
        {modal.type === 'credits' && <Dialog title={t('Credits')} close={close}>
          <div className="form">
            <p className="dialog-intro"><strong className="credits-title">{t('Still Wallet by ow2')}</strong>{t('Open source under the MIT License.')}</p>
            <ul className="credits-list">{team.map(([name, role]) => <li key={name}><span><strong>{name}</strong><small>{t(role)}</small></span></li>)}</ul>
            <p className="dialog-intro">{t('Supported by')}</p>
            <ul className="credits-list">{supporters.map(([name, role]) => <li key={name}><span><strong>{name}</strong><small>{t(role)}</small></span></li>)}</ul>
            <p className="dialog-intro">{t('Data from')}</p>
            <ul className="credits-list">{dataSources.map(([name, kind, use]) => <li key={name}><span><strong>{name}</strong><small>{t(use)}</small></span><em>{t(kind)}</em></li>)}</ul>
            <p className="dialog-intro">{t('Built on these open-source projects:')}</p>
            <ul className="credits-list">
              {credits.map(([name, license, use]) => <li key={name}><span><strong>{name}</strong><small>{use}</small></span><em>{license}</em></li>)}
            </ul>
            <p className="field-note">{t('Thanks to everyone who maintains these projects.')}</p>
          </div>
        </Dialog>}
        {modal.type === 'leave' && <Dialog title={modal.to === 'discord' ? t('Open Discord?') : t('Leave the wallet?')} close={close}>
          <div className="form"><span className="empty-icon">{modal.to === 'discord' ? <ExternalLink size={24} /> : <Info size={24} />}</span>
            <p className="dialog-intro dialog-intro--center">{modal.to === 'discord' ? t('This opens the ow2 Discord in a new tab, outside Still Wallet.') : t('This takes you to the ow2 About page.')}</p>
            <div className="two-actions"><button className="button primary" onClick={close} autoFocus>{t('Cancel')}</button><button className="button secondary" onClick={() => {
              if (modal.to === 'discord') { window.open(discord, '_blank', 'noopener,noreferrer'); closeSheet() }
              else { closeSheet(); window.setTimeout(() => { go('about') }, 280) }
            }}>{modal.to === 'discord' ? t('Open Discord') : t('Continue')}</button></div>
          </div>
        </Dialog>}
        {modal.type === 'protect' && <Dialog title={t('Turn on account protection?')} close={close}>
          <div className="form"><span className="empty-icon"><ShieldAlert size={25} /></span>
            <p className="dialog-intro">{t('After {count} wrong passwords in a row, Still erases this wallet from this browser. You’ll need your recovery phrase to get it back.', { count: maxUnlockAttempts })}</p>
            <div className="two-actions"><button className="button primary" onClick={close} autoFocus>{t('Cancel')}</button><button className="button secondary" onClick={() => { if (wallet.update({ protect: true })) { closeSheet(); notify('Account protection on') } }}>{t('Turn on')}</button></div>
          </div>
        </Dialog>}
        {modal.type === 'passkey' && session && <PasskeyDialog session={session} name={wallet.name} close={close} done={() => { setPasskey(true); closeSheet(); notify(t('Face ID unlock on')) }} />}
        {modal.type === 'offline' && <Dialog title={t('Network requests paused')} close={close}>
          <p className="dialog-intro">{t('Sending and swapping require a connection to your selected RPC.')}</p>
          <a className="button primary wide" href="#settings" onClick={close}>{t('Open privacy settings')} <ArrowRight size={17} /></a>
        </Dialog>}
        {modal.type === 'wallets' && session && <WalletSwitcher wallets={wallet.wallets} active={session.id} close={close} select={(account) => { void wallet.switchWallet(account).then(closeSheet) }} add={() => { closeSheet(); toHome(); void wallet.addWallet() }} rename={wallet.rename} setEmoji={wallet.setEmoji} />}
        {modal.type === 'phrase' && session && <RecoveryPhrase session={session} close={close} />}
        {modal.type === 'contacts' && session && <Contacts contacts={wallet.contacts} edit={wallet.editContact} networks={displayedNetworks} close={close} />}
        {modal.type === 'dapps' && session && <ConnectedApps close={close} offline={preferences.offline} initialLink={modal.link} />}
        {modal.type === 'rename' && session && <RenameWallet current={wallet.name} close={close} save={(value) => { if (wallet.rename(value)) { closeSheet(); notify('Wallet renamed') } }} />}
        {modal.type === 'password' && session && <ChangePassword session={session} close={close} done={() => { closeSheet(); notify('Password changed') }} />}
        {modal.type === 'remove' && session && <RemoveWallet session={session} close={close} removed={() => { wallet.removed(); notify('Wallet deleted') }} />}
    </>
  }
}

function PasskeyDialog({ session, name, close, done }: { session: Session; name: string; close: () => void; done: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [pending, setPending] = useState<Extract<PasskeySetup, { done: false }>>()

  // Runs straight from the tap: phones only show Face ID for a fresh tap.
  async function run() {
    setBusy(true)
    try {
      if (pending) { await pending.confirm(); done(); return }
      const result = await enablePasskey(session, name)
      if (result.done) done()
      else { setError(''); setPending(result) }
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'Face ID unlock could not be turned on.'
      if (message !== 'Cancelled') { setError(message); setTries((value) => value + 1) }
    } finally { setBusy(false) }
  }

  return <Dialog title={pending ? t('One more step') : t('Turn on Face ID unlock?')} close={close} busy={busy}>
    <div className="form"><span className="empty-icon"><ScanFace size={25} /></span>
      <p className="dialog-intro dialog-intro--center">{pending ? t('Confirm with Face ID once more to finish.') : t('Still saves a passkey on this phone. Face ID opens the wallet, your password keeps working too.')}</p>
      <ErrorSlot error={error} attempt={tries} />
      {pending
        ? <button className="button primary wide" onClick={() => void run()} disabled={busy}><ScanFace size={17} />{t('Confirm with Face ID')}</button>
        : <div className="two-actions"><button className="button primary" onClick={close} disabled={busy} autoFocus>{t('Cancel')}</button><button className="button secondary" onClick={() => void run()} disabled={busy}><span key={String(busy)} className="label-swap">{busy ? t('Waiting…') : t('Turn on')}</span></button></div>}
    </div>
  </Dialog>
}

function RemoveWallet({ session, close, removed }: { session: Session; close: () => void; removed: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const { unlockVault, removeVault } = await import('./vault')
      const verified = await unlockVault(password)
      if (verified.vault !== session.vault) throw new Error('The saved wallet changed. Try again.')
      await removeVault(session.vault)
      try { forgetVault() } finally { removed() }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The wallet could not be deleted.')
      setTries((value) => value + 1)
    } finally { setBusy(false) }
  }

  return <Dialog title={t('Delete wallet?')} close={close} busy={busy}>
    <form className="form" autoComplete="off" onSubmit={remove}>
      <Notice>{t('This deletes every wallet, name, emoji, activity and setting Still saved in this browser. Make sure you have your recovery phrase, it’s the only way to get your funds back.')}</Notice>
      <label className={error ? 'field field--wrong' : 'field'}>{t('Wallet pass⁠word')}<PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /></label>
      <ErrorSlot error={error} attempt={tries} />
      <div className="two-actions"><button className="button primary" type="button" onClick={close} disabled={busy}>{t('Cancel')}</button><button className="button secondary" type="submit" disabled={busy}><span key={String(busy)} className="label-swap">{busy ? t('Deleting…') : t('Delete wallet')}</span></button></div>
    </form>
  </Dialog>
}

function ChangePassword({ session, close, done }: { session: Session; close: () => void; done: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [wrong, setWrong] = useState(false)
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)

  function fail(message: string, currentWrong = false) {
    setError(message)
    setWrong(currentWrong)
    setTries((value) => value + 1)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!passwordRules.every((rule) => rule.test(next))) return fail('Your new password doesn’t meet all the requirements yet.')
    if (next !== confirmation) return fail('The passwords do not match.')
    if (next === current) return fail('Pick a password different from your current one.')
    setBusy(true)
    try {
      const { changePassword } = await import('./vault')
      await changePassword(session.vault, current, next)
      done()
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'The password could not be changed. Nothing was changed.'
      fail(message, message === 'Incorrect password')
    } finally { setBusy(false) }
  }

  return <Dialog title={t('Change pass\u2060word')} close={close} busy={busy}>
    <form className="form" autoComplete="off" onSubmit={submit}>
      <label className={wrong ? 'field field--wrong' : 'field'}>{t('Current pass\u2060word')}<PasswordInput value={current} onChange={(event) => { setCurrent(event.target.value); setWrong(false) }} autoFocus required maxLength={256} /></label>
      <label className="field">{t('New pass\u2060word')}<PasswordInput value={next} onChange={(event) => setNext(event.target.value)} required maxLength={256} aria-describedby="new-password-rules" /></label>
      <ul className="password-rules" id="new-password-rules" aria-live="polite">
        {passwordRules.map((rule) => { const met = rule.test(next); return <li key={rule.label} className={met ? 'met' : ''}>{met ? <Check size={14} /> : <X size={14} />}{t(rule.label)}</li> })}
      </ul>
      <label className="field">{t('Confirm pass\u2060word')}<PasswordInput value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={256} /></label>
      <ErrorSlot error={error} attempt={tries} />
      <button className="button primary wide" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={17} />}<span key={String(busy)} className="label-swap">{busy ? t('Changing…') : t('Change pass\u2060word')}</span></button>
    </form>
  </Dialog>
}

// Locked: only the unlock form, no balances or names.
function LockScreen({ mainRef, protect, preload, onSession, removed }: { mainRef: RefObject<HTMLElement | null>; protect: boolean; preload: (session: Session) => Promise<void>; onSession: (session: Session) => void; removed: (message: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [forgot, setForgot] = useState(false)
  // Forgot password slides like sheet steps. Logo stays put.
  const cameBack = useRef(false)
  const [tries, setTries] = useState(0)
  const [failures, setFailures] = useState(failedUnlocks)
  const [passkey] = useState(passkeyOn)
  // Face ID right away, like a banking app. Phones that want a tap first just ignore it.
  const asked = useRef(false)
  useEffect(() => {
    if (!passkey || asked.current) return
    asked.current = true
    void faceId(true)
  }, [passkey])
  // Wrong password error fades after a few seconds.
  useEffect(() => {
    if (!error || busy) return
    const timer = window.setTimeout(() => setError(''), 6000)
    return () => window.clearTimeout(timer)
  }, [error, tries, busy])

  async function reset(message = 'Wallet deleted') {
    setError('')
    setBusy(true)
    try {
      const { removeVault } = await import('./vault')
      const id = savedVaultId() ?? ''
      await removeVault(id)
      try { forgetVault() } finally { removed(message) }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The local wallet could not be removed.')
      setBusy(false)
    }
  }

  if (forgot) return <main ref={mainRef} id="main-content" className="lock-screen" tabIndex={-1}>
    <div className="lock-top"><Brand name="Still Wallet" stacked /></div>
    <div className="lock-card form lock-card--swap">
      <h1>{t('Forgot your password?')}</h1>
      <p className="dialog-intro">{t('Still can’t recover it. You can delete this wallet from this browser and restore it later with your recovery phrase. This can’t be undone.')}</p>
      <ErrorSlot error={error} />
      <div className="two-actions"><button type="button" className="button primary" disabled={busy} onClick={() => { cameBack.current = true; setForgot(false) }} autoFocus>{t('Cancel')}</button><button type="button" className="button secondary" disabled={busy} onClick={() => void reset()}><span key={String(busy)} className="label-swap">{busy ? t('Deleting…') : t('Delete wallet')}</span></button></div>
    </div>
  </main>

  async function finish(session: Session) {
    try { saveFailedUnlocks(0) } catch { /* Counter reset is best effort. */ }
    // Unlock ok: load balances while still on this screen, so the wallet opens filled in.
    try { await preload(session) } catch { /* The wallet retries on its own. */ }
    // Then open the padlock, then the wallet.
    setUnlocked(true)
    window.setTimeout(() => onSession(session), 650)
  }

  async function faceId(quiet = false) {
    if (busy) return
    setBusy(true)
    try {
      await finish(await unlockWithPasskey())
    } catch (problem) {
      // Cancel and the silent first try stay quiet. Never counts as a wrong password.
      if (!quiet && problem instanceof Error && problem.message !== 'Cancelled') { setError(problem.message); setTries((value) => value + 1) }
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Keep the old error up while checking so a 2nd wrong try does not flicker it.
    setBusy(true)
    try {
      const { unlockVault } = await import('./vault')
      await finish(await unlockVault(password))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The local wallet could not be opened.')
      setTries((value) => value + 1)
      setBusy(false)
      // Only real wrong passwords count. Re-read storage so other tabs can't each get their own 5 tries.
      if (!protect || !(problem instanceof Error && problem.message === 'Incorrect password')) return
      const count = failedUnlocks() + 1
      try { saveFailedUnlocks(count) } catch { /* Still enforce within this session. */ }
      setFailures(count)
      setPassword('')
      if (count >= maxUnlockAttempts) await reset('Too many wrong passwords. Wallet erased')
    }
  }

  return <main ref={mainRef} id="main-content" className="lock-screen" tabIndex={-1}>
    <div className="lock-top"><Brand name="Still Wallet" stacked /></div>
    <form autoComplete="off" className={cameBack.current ? 'lock-card form lock-card--swap lock-card--back' : 'lock-card form'} onSubmit={submit}>
      <h1>{t('Enter your password')}</h1>
      <label className={error ? 'field field--wrong' : 'field'}><PasswordInput aria-label={t('Wallet key')} aria-invalid={!!error} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('Password')} required maxLength={256} autoFocus /></label>
      {protect && failures > 0 && (maxUnlockAttempts - failures === 1
        ? <p className="last-try" role="alert"><ShieldAlert size={18} /><span><strong>{t('Last try')}</strong>{t('One more wrong password erases this wallet.')}</span></p>
        : <p className="attempts-left">{t('{count} tries left before this wallet is erased', { count: maxUnlockAttempts - failures })}</p>)}
      <ErrorSlot error={error} attempt={tries} />
      <button type="submit" className="button primary wide" disabled={busy || !password}>
        <span key={unlocked ? 'open' : String(busy)} className="label-swap">{unlocked ? <LockKeyhole size={17} className="unlocking" /> : busy ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={17} />}{unlocked ? t('Unlocked') : busy ? t('Unlocking…') : t('Unlock')}</span>
      </button>
      {passkey && <button type="button" className="button secondary wide" disabled={busy} onClick={() => void faceId()}><ScanFace size={17} />{t('Use Face ID')}</button>}
      <button type="button" className="button text-button wide" onClick={() => { setError(''); setForgot(true) }}>{t('Forgot password?')}</button>
    </form>
  </main>
}

function RenameWallet({ current, close, save }: { current: string; close: () => void; save: (value: string) => void }) {
  const [value, setValue] = useState(current)
  const name = normalizeWalletName(value)
  return <Dialog title={t('Wallet name')} close={close}>
    <form className="form" onSubmit={(event) => { event.preventDefault(); if (name) save(name) }}>
      <label className="field">{t('Na\u2060me')}<input value={value} onChange={(event) => setValue(event.target.value)} maxLength={24} name="wallet-label" autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore data-lpignore="true" autoFocus placeholder={t('Wallet {number}', { number: 1 })} /></label>
      <p className="field-note">{t('Only shown on this device.')}</p>
      <button className="button primary wide" type="submit" disabled={!name || name === current}>{t('Save name')}</button>
    </form>
  </Dialog>
}

type WalletEntry = { id: string; account: number; name: string; emoji: string }

function WalletSwitcher({ wallets, active, close, select, add, rename, setEmoji }: {
  wallets: WalletEntry[]; active: string; close: () => void; select: (account: number) => void; add: () => void
  rename: (value: string, id: string) => boolean; setEmoji: (id: string, emoji: string) => void
}) {
  const [editing, setEditing] = useState<string>()
  const [value, setValue] = useState('')
  const entry = wallets.find((item) => item.id === editing)

  if (entry) {
    const name = normalizeWalletName(value)
    return <Dialog title={t('Edit wallet')} close={close}>
      <form className="form" onSubmit={(event) => { event.preventDefault(); if (name && (name === entry.name || rename(name, entry.id))) setEditing(undefined) }}>
        <span className="wallet-emoji wallet-emoji--large" aria-hidden="true">{entry.emoji}</span>
        <EmojiPicker current={entry.emoji} pick={(emoji) => setEmoji(entry.id, emoji)} />
        <label className="field">{t('Na\u2060me')}<input value={value} onChange={(event) => setValue(event.target.value)} maxLength={24} name="wallet-label" autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore data-lpignore="true" placeholder={entry.name} /></label>
        <button className="button primary wide" type="submit" disabled={!name}>{t('Done')}</button>
        <button type="button" className="button text-button wide" onClick={() => setEditing(undefined)}><ArrowLeft size={16} /> {t('Back')}</button>
      </form>
    </Dialog>
  }

  return <Dialog title={t('Wallets')} close={close}>
    <ul className="wallet-list">
      {wallets.map((item) => <li key={item.id} className={item.id === active ? 'active' : ''}>
        <button type="button" className="wallet-pick" onClick={() => select(item.account)} aria-current={item.id === active ? 'true' : undefined}>
          <span className="wallet-emoji" aria-hidden="true">{item.emoji}</span><strong>{item.name}</strong>{item.id === active && <Check size={17} />}
        </button>
        <button type="button" className="round-button" aria-label={t('Edit {name}', { name: item.name })} onClick={() => { setValue(item.name); setEditing(item.id) }}><Pencil size={16} /></button>
      </li>)}
    </ul>
    <button type="button" className="button secondary wide" onClick={add}><Plus size={17} /> {t('Add wallet')}</button>
  </Dialog>
}
