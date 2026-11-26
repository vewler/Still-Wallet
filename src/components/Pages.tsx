import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Activity as ActivityIcon, ArrowUp, BookUser, ChevronLeft, ChevronRight, CircleHelp, Coins, FileKey, ExternalLink, EyeOff, Globe2, Heart, ShieldCheck, Info, KeyRound, Link2, LockKeyhole, PackagePlus, MessageCircle, Percent, ScanFace, Search, X, ShieldAlert, Trash2, WifiOff, Languages } from 'lucide-react'
import { activeNetworks, defaultEndpoint, explorerUrl, networks, validateEndpoint, type Network } from '../networks'
import { currencies, customSlippageRange, validCustomSlippage, type ActivityItem, type Currency, type Preferences } from '../storage'
import { RefreshIcon } from './Spinner'
import { Coin } from './Icons'
import { Picker } from './Picker'
import { Dialog, ErrorSlot, Notice, Slot } from './Dialog'
import { tokenById } from '../tokens'
import { arrangeAssets, popularAssets, type AssetLayout } from '../assets'
import { deviceLanguage, languageChoice, languages, setLanguage, t, type Language } from '../i18n'

export function Heading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-title"><h1>{t(title)}</h1>{action}</div>
}

export function ActivityPage({ mode, items, hidden, canRefresh, refreshing, refresh }: {
  mode: 'none' | 'locked' | 'wallet'; items: ActivityItem[]; hidden: boolean; canRefresh: boolean; refreshing: boolean; refresh: () => void
}) {
  const labels = { confirmed: 'Confirmed', submitted: 'Pending', failed: 'Failed', unknown: 'Unverified', expired: 'Expired' }
  return <div className="page">
    <Heading title="Activity" action={mode === 'wallet' && <button className="round-button" aria-label={t('Check transaction status')} disabled={!canRefresh || refreshing} onClick={refresh}><RefreshIcon size={18} spinning={refreshing} /></button>} />
    {mode === 'wallet' && items.length > 0 && <div className="token-list">{items.map((item) => {
      const network = networks[item.network]
      const symbol = tokenById(item.asset ?? '')?.symbol ?? network.symbol
      return <a href={explorerUrl(network, 'tx', item.hash)} target="_blank" rel="noreferrer" className="token" key={item.network + item.hash}>
        <span className="tx-icon"><Coin chain={network.chain} /><i className="tx-badge"><ArrowUp size={11} /></i></span>
        <span className="token-name"><strong>{item.kind === 'dapp' ? item.app || t('App transaction') : item.kind === 'approval' ? t('Token permission') : item.kind === 'swap' ? t('Swap to {symbol}', { symbol: item.receive?.symbol ?? t('token') }) : t('Sent')}</strong><small>{network.name} {network.label} · {new Date(item.created).toLocaleDateString()}</small></span>
        <span className="token-value"><strong>{hidden ? '••••' : `${item.kind === 'approval' || (item.kind === 'dapp' && /^0(\.0*)?$/.test(item.value)) ? '' : '−'}${item.value} ${symbol}`}</strong><small key={item.status} className={`tx-status tx-status--${item.status}`}>{t(labels[item.status])}</small></span>
      </a>
    })}</div>}
    {(mode !== 'wallet' || items.length === 0) && <div className="empty-state">
      <span className="empty-icon">{mode === 'locked' ? <LockKeyhole size={26} /> : <ActivityIcon size={26} />}</span>
      <h2>{mode === 'locked' ? t('Unlock to view activity') : mode === 'none' ? t('No wallet yet') : t('No activity yet')}</h2>
      <p>{mode === 'locked' ? t('Your activity shows up after you unlock Still.') : mode === 'none' ? t('Set up a wallet to send and receive.') : t('Transfers you send from Still will show up here.')}</p>
    </div>}
  </div>
}

type Health = { state: 'checking' } | { state: 'ok'; ms: number } | { state: 'down' } | { state: 'paused' }

export function NetworksPage({ preferences, layout, edit }: {
  preferences: Preferences; layout: AssetLayout; edit: (network: Network) => void
}) {
  const list = activeNetworks(preferences.environment)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  // Without a search: networks of the Home coins, ones with a custom RPC, then popular ones. Search finds the rest.
  const relevant = [...new Set([
    ...arrangeAssets(preferences.environment, layout).filter((entry) => entry.shown).map((entry) => entry.asset.network),
    ...list.filter((network) => preferences.rpc[network.id]).map((network) => network.id),
    ...popularAssets.map((id) => id.split(':')[0]),
  ])]
  const shownNetworks = needle
    ? list.filter((network) => [network.name, network.symbol, network.label].some((text) => text.toLowerCase().includes(needle)))
    : relevant.map((id) => list.find((network) => network.id === id)).filter((network): network is Network => !!network)
  const [health, setHealth] = useState<Partial<Record<string, Health>>>({})
  const [round, setRound] = useState(0)

  // Ping the providers of the networks on screen, on open, on refresh and as search shows more.
  const pinging = useRef<{ controller: AbortController; checked: Set<string> }>(null)
  useEffect(() => {
    const current = { controller: new AbortController(), checked: new Set<string>() }
    pinging.current = current
    setHealth({})
    return () => current.controller.abort()
  }, [preferences.offline, preferences.rpc, round])
  const shownKey = shownNetworks.map((network) => network.id).join(',')
  useEffect(() => {
    const current = pinging.current
    if (preferences.offline || !current) return
    const fresh = shownNetworks.filter((network) => !current.checked.has(network.id))
    if (!fresh.length) return
    fresh.forEach((network) => current.checked.add(network.id))
    const { signal } = current.controller
    setHealth((value) => ({ ...value, ...Object.fromEntries(fresh.map((network) => [network.id, { state: 'checking' }])) }))
    void import('../rpc').then(({ testEndpoint }) => fresh.forEach((network) => {
      const start = performance.now()
      testEndpoint(network, preferences.rpc[network.id] ?? defaultEndpoint(network), signal)
        .then(() => ({ state: 'ok', ms: Math.round(performance.now() - start) }) as const, () => ({ state: 'down' }) as const)
        .then((result) => { if (!signal.aborted) setHealth((value) => ({ ...value, [network.id]: result })) })
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, preferences.offline, preferences.rpc, round])

  const checking = Object.values(health).some((entry) => entry?.state === 'checking')
  return <div className="page">
    <a className="back-link" href="#settings"><ChevronLeft size={18} />{t('Settings')}</a>
    <Heading title="Networks" action={!preferences.offline && <button className="round-button" aria-label={t('Check all networks again')} disabled={checking} onClick={() => setRound((value) => value + 1)}><RefreshIcon size={18} spinning={checking} /></button>} />
    <label className="field manage-search">
      <Search size={18} aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search networks')} aria-label={t('Search networks')} name="network-search" type="text" inputMode="search" enterKeyHint="search"
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={40} data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      {query && <button type="button" className="manage-search-clear" aria-label={t('Clear search')} onClick={() => setQuery('')}><X size={16} /></button>}
    </label>
    {needle && !shownNetworks.length ? <p className="manage-none">{t('No networks found')}</p> : <>
    <p className="group-label">{t('RPC providers')}</p>
    <div className="group">
      {shownNetworks.map((network) => {
        const custom = preferences.rpc[network.id]
        const status: Health = preferences.offline ? { state: 'paused' } : health[network.id] ?? { state: 'checking' }
        return <button key={network.id} className="row network-row" onClick={() => edit(network)}>
          <Coin chain={network.chain} />
          <span className="row-text">
            <strong>{network.name}{custom && <span className="network-badge">{t('Custom')}</span>}</strong>
            <small>{custom ? new URL(custom).host : t('Still gateway')}</small>
          </span>
          <span className={`network-status network-status--${status.state}`}>
            <span className="network-dot" />
            {status.state === 'ok' ? `${status.ms} ms` : status.state === 'down' ? t('Offline') : status.state === 'paused' ? t('Paused') : t('Checking')}
          </span>
          <ChevronRight size={18} className="row-chevron" />
        </button>
      })}
    </div>
    </>}
    {!needle && <p className="manage-more">{t('Search to find more networks')}</p>}
    <div className="network-note"><Info size={16} /><p>{t('The Still gateway and its chain provider can see your network requests. A custom RPC connects straight from your browser to the provider you choose. Tap a network to change it.')}</p></div>
  </div>
}

export function RpcDialog({ network, current, offline, close, save, test }: {
  network: Network; current?: string; offline: boolean; close: () => void; save: (value?: string) => void;
  test: (network: Network, value: string, signal: AbortSignal) => Promise<void>
}) {
  const [endpoint, setEndpoint] = useState(current ?? '')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function testConnection() {
    setResult('')
    setTesting(true)
    const controller = new AbortController()
    request.current = controller
    try {
      await test(network, endpoint.trim() ? validateEndpoint(endpoint.trim(), network.chain) : defaultEndpoint(network), controller.signal)
      if (!controller.signal.aborted) setError('')
      if (!controller.signal.aborted) setResult(t('Connected to {network}.', { network: `${network.name} ${network.label}` }))
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error && problem.message.startsWith('Monero') ? problem.message : 'Connection failed. Check the URL, browser CORS access, and network.')
    } finally {
      if (!controller.signal.aborted) setTesting(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try { save(endpoint.trim() ? validateEndpoint(endpoint.trim(), network.chain) : undefined) }
    catch (problem) { setError(problem instanceof Error && problem.message.startsWith('Monero') ? problem.message : 'Enter a valid HTTPS RPC URL or a local HTTP endpoint.') }
  }

  return <Dialog title={`${network.name} RPC`} close={close}>
    <form className="form" onSubmit={submit}>
      <p className="dialog-intro">{t('Set a browser-accessible {api} for {network}. Leave it blank to use the Still gateway.', { api: network.chain === 'stacks' ? 'Stacks API (Hiro-compatible)' : network.chain === 'filecoin' ? t('Lotus JSON-RPC endpoint') : network.chain === 'tezos' ? t('Tezos node RPC') : network.chain === 'ton' ? 'toncenter-style API (/api)' : network.chain === 'hypercore' ? 'Hyperliquid API' : network.chain === 'cardano' ? 'Koios API' : network.chain === 'stellar' ? 'Horizon API' : network.chain === 'multiversx' ? 'MultiversX gateway API' : network.chain === 'algorand' ? 'Algorand node (algod) API' : ['cosmos', 'celestia', 'kava', 'axelar', 'injective'].includes(network.chain) ? 'Cosmos REST (LCD) API' : network.chain === 'bitcoin' || network.chain === 'litecoin' || network.chain === 'dogecoin' ? 'Esplora API' : network.chain === 'tron' ? 'Tron HTTP API (java-tron /wallet)' : network.chain === 'monero' ? t('Monero daemon (monerod) RPC') : network.chain === 'sui' ? t('Sui GraphQL endpoint') : network.chain === 'aptos' ? 'Aptos REST API (/v1)' : t('JSON-RPC endpoint'), network: `${network.name} ${network.label}` })}</p>
      <label className="field">{t('Custom RPC URL')}<input value={endpoint} placeholder={network.rpc} maxLength={2048} inputMode="url" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} onChange={(event) => { request.current?.abort(); setTesting(false); setEndpoint(event.target.value); setResult('') }} /></label>
      <Slot open={offline}><Notice>{t('Network requests are paused in Settings.')}</Notice></Slot>
      <ErrorSlot error={error} />
      <Slot open={!!result}><p className="success" role="status">{result}</p></Slot>
      <div className="two-actions"><button type="button" className="button secondary" onClick={() => void testConnection()} disabled={offline || testing}><span key={String(testing)} className="label-swap">{testing ? t('Connecting…') : t('Test connection')}</span></button><button className="button primary" type="submit">{t('Save endpoint')}</button></div>
    </form>
  </Dialog>
}

function Setting({ icon, title, detail, children }: { icon: ReactNode; title: string; detail?: string; children: ReactNode }) {
  return <div className="row"><span className="row-icon">{icon}</span><span className="row-text"><strong>{t(title)}</strong>{detail && <small>{t(detail)}</small>}</span>{children}</div>
}

/** Rows ripple in top to bottom. With fromScreen the ripple starts at the first row on screen, so coming back low on the page doesn't wait on the rows above. */
export function staggerSettings(root: ParentNode, fromScreen = false) {
  const rows = [...root.querySelectorAll<HTMLElement>('.group-label, .group > *')]
  const first = fromScreen ? Math.max(0, rows.findIndex((row) => row.getBoundingClientRect().bottom > 0)) : 0
  rows.forEach((row, index) => { row.style.animationDelay = `${Math.max(0, index - first) * 17.5}ms` })
}

export function SettingsPage({ contacts, openContacts, importToken, phrase, slippage, preferences, update, mode, lock, remove, setup, protect, credits, leave, passkey, togglePasskey, changePassword, apps, appCount = 0 }: {
  /** Opens the custom slippage dialog. */
  slippage: () => void
  /** Import a token by its contract address. */
  importToken: () => void
  /** Connected apps (WalletConnect). */
  apps?: () => void; appCount?: number; preferences: Preferences; update: (value: Partial<Preferences>) => boolean; mode: 'none' | 'locked' | 'wallet'; lock: () => void;
  remove: () => void; setup: () => void; protect: () => void; credits: () => void
  contacts: number; openContacts: () => void
  /** Show the recovery phrase, after the password. */
  phrase: () => void
  /** Undefined hides the row (desktop, or no wallet open). */
  passkey?: boolean; togglePasskey: () => void
  changePassword: () => void
  /** Confirm before leaving for the ow2 About page or Discord. */
  leave: (to: 'about' | 'discord') => void
}) {
  // One stagger for the whole page.
  const page = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => staggerSettings(page.current!), [])
  return <div ref={page} className="page settings-page">
    <Heading title="Settings" />
    <p className="group-label">{t('Privacy')}</p>
    <div className="group">
      <Setting icon={<EyeOff size={19} />} title="Hide balances" detail="Mask amounts across the app">
        <button className="toggle" type="button" role="switch" aria-label={t('Hide balances')} aria-checked={preferences.hide} onClick={() => update({ hide: !preferences.hide })}><span /></button>
      </Setting>
      <Setting icon={<WifiOff size={19} />} title="Pause network requests" detail="Receive addresses stay available">
        <button className="toggle" type="button" role="switch" aria-label={t('Pause network requests')} aria-checked={preferences.offline} onClick={() => update({ offline: !preferences.offline })}><span /></button>
      </Setting>
      {passkey !== undefined && <Setting icon={<ScanFace size={19} />} title="Face ID unlock" detail="Unlock with a passkey, your password still works">
        <button className="toggle" type="button" role="switch" aria-label={t('Face ID unlock')} aria-checked={passkey} onClick={togglePasskey}><span /></button>
      </Setting>}
      <Setting icon={<ShieldAlert size={19} />} title="Account protection" detail="Erase this wallet after 5 wrong passwords">
        <button className="toggle" type="button" role="switch" aria-label={t('Account protection')} aria-checked={preferences.protect} onClick={protect}><span /></button>
      </Setting>
      <Setting icon={<Coins size={19} />} title="Currency">
        <Picker compact label={t('Display currency')} value={preferences.currency} onChange={(currency: Currency) => update({ currency })}
          options={currencies.map((code) => ({ value: code, label: code.toUpperCase() }))} />
      </Setting>
      <Setting icon={<Languages size={19} />} title="Language">
        <Picker compact label={t('Language')} value={languageChoice()} onChange={(value: Language | 'auto') => void setLanguage(value)}
          options={[{ value: 'auto' as const, label: t('Auto'), sub: languages.find(([code]) => code === deviceLanguage())![1] }, ...languages.map(([value, label]) => ({ value, label }))]} />
      </Setting>
      <Setting icon={<LockKeyhole size={19} />} title="Auto-lock">
        <Picker compact label={t('Auto-lock interval')} value={preferences.autoLock} onChange={(autoLock: number) => update({ autoLock })}
          options={[0, 1, 5, 15, 30].map((value) => ({ value, label: value ? t('{count} min', { count: value }) : t('Instant') }))} />
      </Setting>
    </div>
    <p className="group-label">{t('Advanced')}</p>
    <div className="group">
      {mode === 'wallet' && <button className="row" onClick={openContacts}><span className="row-icon"><BookUser size={19} /></span><span className="row-text"><strong>{t('Address book')}</strong><small>{contacts === 1 ? t('1 contact') : contacts ? t('{count} contacts', { count: contacts }) : t('Save addresses you send to')}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
      {mode === 'wallet' && <button className="row" onClick={importToken}><span className="row-icon"><PackagePlus size={19} /></span><span className="row-text"><strong>{t('Import token')}</strong><small>{t('Add a token by its contract address')}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
      <button className="row" onClick={slippage}><span className="row-icon"><Percent size={19} /></span><span className="row-text"><strong>{t('Custom slippage')}</strong><small>{preferences.slippage ? t('{value} in Max slippage', { value: slippagePercent(preferences.slippage) }) : t('Not set')}</small></span><ChevronRight size={18} className="row-chevron" /></button>
      {mode === 'wallet' && apps && <button className="row" onClick={apps}><span className="row-icon"><Link2 size={19} /></span><span className="row-text"><strong>{t('Connected apps')}</strong><small>{appCount ? t('{count} connected', { count: appCount }) : 'WalletConnect'}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
      <a className="row" href="#networks"><span className="row-icon"><Globe2 size={19} /></span><span className="row-text"><strong>{t('Networks')}</strong><small>{t('RPC providers')}</small></span><ChevronRight size={18} className="row-chevron" /></a>
    </div>
    <p className="group-label">{t('This device')}</p>
    <div className="group">
      <button className="row" onClick={mode === 'wallet' ? lock : setup}><span className="row-icon"><KeyRound size={19} /></span><span className="row-text"><strong>{mode === 'none' ? t('Set up wallet') : mode === 'locked' ? t('Unlock wallet') : t('Lock wallet')}</strong><small>{mode === 'none' ? t('Create or restore a wallet') : t('Vault is password protected')}</small></span><ChevronRight size={18} className="row-chevron" /></button>
      {mode === 'wallet' && <button className="row" onClick={changePassword}><span className="row-icon"><LockKeyhole size={19} /></span><span className="row-text"><strong>{t('Change pass\u2060word')}</strong><small>{t('Enter your current one to set a new one')}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
      {mode === 'wallet' && <button className="row" onClick={phrase}><span className="row-icon"><FileKey size={19} /></span><span className="row-text"><strong>{t('Recovery phrase')}</strong><small>{t('View your secret words, needs your password')}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
      {mode === 'wallet' && <button className="row" onClick={remove}><span className="row-icon danger-text"><Trash2 size={19} /></span><span className="row-text"><strong className="danger-text">{t('Delete wallet')}</strong><small>{t('Erase all wallets and data from this browser')}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
    </div>
    <p className="group-label">{t('About')}</p>
    <div className="group">
      <button className="row" onClick={() => leave('about')}><span className="row-icon"><Info size={19} /></span><span className="row-text"><strong>{t('About Still')}</strong></span><ExternalLink size={16} className="row-chevron" /></button>
      <button className="row" onClick={() => leave('discord')}><span className="row-icon"><MessageCircle size={19} /></span><span className="row-text"><strong>Discord</strong></span><ExternalLink size={16} className="row-chevron" /></button>
      <a className="row" href="#faq"><span className="row-icon"><CircleHelp size={19} /></span><span className="row-text"><strong>FAQ</strong></span><ChevronRight size={18} className="row-chevron" /></a>
      <a className="row" href="#privacy"><span className="row-icon"><ShieldCheck size={19} /></span><span className="row-text"><strong>{t('Privacy Policy')}</strong></span><ChevronRight size={18} className="row-chevron" /></a>
      <button className="row" onClick={credits}><span className="row-icon"><Heart size={19} /></span><span className="row-text"><strong>{t('Credits')}</strong></span><ChevronRight size={18} className="row-chevron" /></button>
    </div>
    <p className="version">{t('Still Wallet by ow2')}</p>
  </div>
}

export const slippagePercent = (bps: number) => `${bps / 100}%`

/** Set or remove the custom swap slippage. Only shows up in Swap once it's set. */
export function SlippageDialog({ current, close, save }: { current?: number; close: () => void; save: (value: number | undefined) => void }) {
  const [value, setValue] = useState(current ? String(current / 100) : '')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  function fail(message: string) { setError(message); setTries((count) => count + 1) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = value.trim().replace(',', '.').replace(/%$/, '').trim()
    if (!/^\d{1,2}(\.\d{1,2})?$|^\.\d{1,2}$/.test(text)) return fail('Enter a number like 0.8, up to 2 decimals.')
    const bps = Math.round(Number(text) * 100)
    if (!validCustomSlippage(bps)) return fail('Slippage must be between {min} and {max}.')
    save(bps)
  }
  return <Dialog title={t('Custom slippage')} close={close}>
    <form className="form" onSubmit={submit} noValidate>
      <p className="dialog-intro">{t('Adds a Custom option to Max slippage in Swap. Higher slippage fills more often but can cost more.')}</p>
      <label className="field">{t('Slippage (%)')}<input value={value} onChange={(event) => { setValue(event.target.value); setError('') }} inputMode="decimal" maxLength={6} name="slippage" autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore data-lpignore="true" autoFocus placeholder="0.8" /></label>
      <ErrorSlot error={error && t(error, { min: slippagePercent(customSlippageRange[0]), max: slippagePercent(customSlippageRange[1]) })} attempt={tries} />
      {current ? <div className="two-actions"><button type="button" className="button secondary" onClick={() => save(undefined)}>{t('Remove')}</button><button className="button primary" type="submit" disabled={!value.trim()}>{t('Save')}</button></div>
        : <button className="button primary wide" type="submit" disabled={!value.trim()}>{t('Save')}</button>}
    </form>
  </Dialog>
}
