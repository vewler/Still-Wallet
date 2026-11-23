import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Activity as ActivityIcon, ArrowUp, ChevronLeft, ChevronRight, CircleHelp, Coins, ExternalLink, EyeOff, Globe2, Heart, ShieldCheck, Info, KeyRound, LockKeyhole, MessageCircle, Pencil, ShieldAlert, Trash2, WifiOff } from 'lucide-react'
import { activeNetworks, defaultEndpoint, explorerUrl, networks, validateEndpoint, type Network } from '../networks'
import { currencies, type ActivityItem, type Currency, type Preferences } from '../storage'
import { RefreshIcon } from './Spinner'
import { Coin } from './Icons'
import { Picker } from './Picker'
import { Dialog, ErrorSlot, Notice, Slot } from './Dialog'
import { tokenById } from '../tokens'

export function Heading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-title"><h1>{title}</h1>{action}</div>
}

export function ActivityPage({ mode, items, hidden, canRefresh, refreshing, refresh }: {
  mode: 'none' | 'locked' | 'wallet'; items: ActivityItem[]; hidden: boolean; canRefresh: boolean; refreshing: boolean; refresh: () => void
}) {
  const labels = { confirmed: 'Confirmed', submitted: 'Pending', failed: 'Failed', unknown: 'Unverified', expired: 'Expired' }
  return <div className="page">
    <Heading title="Activity" action={mode === 'wallet' && <button className="round-button" aria-label="Check transaction status" disabled={!canRefresh || refreshing} onClick={refresh}><RefreshIcon size={18} spinning={refreshing} /></button>} />
    {mode === 'wallet' && items.length > 0 && <div className="token-list">{items.map((item) => {
      const network = networks[item.network]
      const symbol = tokenById(item.asset ?? '')?.symbol ?? network.symbol
      return <a href={explorerUrl(network, 'tx', item.hash)} target="_blank" rel="noreferrer" className="token" key={item.network + item.hash}>
        <span className="tx-icon"><Coin chain={network.chain} /><i className="tx-badge"><ArrowUp size={11} /></i></span>
        <span className="token-name"><strong>{item.kind === 'approval' ? 'Token permission' : item.kind === 'swap' ? `Swap to ${item.receive?.symbol ?? 'token'}` : 'Sent'}</strong><small>{network.name} {network.label} · {new Date(item.created).toLocaleDateString()}</small></span>
        <span className="token-value"><strong>{hidden ? '••••' : `${item.kind === 'approval' ? '' : '−'}${item.value} ${symbol}`}</strong><small key={item.status} className={`tx-status tx-status--${item.status}`}>{labels[item.status]}</small></span>
      </a>
    })}</div>}
    {(mode !== 'wallet' || items.length === 0) && <div className="empty-state">
      <span className="empty-icon">{mode === 'locked' ? <LockKeyhole size={26} /> : <ActivityIcon size={26} />}</span>
      <h2>{mode === 'locked' ? 'Unlock to view activity' : mode === 'none' ? 'No wallet yet' : 'No activity yet'}</h2>
      <p>{mode === 'locked' ? 'Your activity shows up after you unlock Still.' : mode === 'none' ? 'Set up a wallet to send and receive.' : 'Transfers you send from Still will show up here.'}</p>
    </div>}
  </div>
}

type Health = { state: 'checking' } | { state: 'ok'; ms: number } | { state: 'down' } | { state: 'paused' }

export function NetworksPage({ preferences, edit }: {
  preferences: Preferences; edit: (network: Network) => void
}) {
  const list = activeNetworks(preferences.environment)
  const [health, setHealth] = useState<Partial<Record<string, Health>>>({})
  const [round, setRound] = useState(0)

  // Ping each network's provider on open and on refresh.
  useEffect(() => {
    if (preferences.offline) return
    const controller = new AbortController()
    setHealth(Object.fromEntries(list.map((network) => [network.id, { state: 'checking' }])))
    void import('../rpc').then(({ testEndpoint }) => list.forEach((network) => {
      const start = performance.now()
      testEndpoint(network, preferences.rpc[network.id] ?? defaultEndpoint(network), controller.signal)
        .then(() => ({ state: 'ok', ms: Math.round(performance.now() - start) }) as const, () => ({ state: 'down' }) as const)
        .then((result) => { if (!controller.signal.aborted) setHealth((current) => ({ ...current, [network.id]: result })) })
    }))
    return () => controller.abort()
  }, [preferences.offline, preferences.rpc, round])

  const checking = Object.values(health).some((entry) => entry?.state === 'checking')
  return <div className="page">
    <a className="back-link" href="#settings"><ChevronLeft size={18} />Settings</a>
    <Heading title="Networks" action={!preferences.offline && <button className="round-button" aria-label="Check all networks again" disabled={checking} onClick={() => setRound((value) => value + 1)}><RefreshIcon size={18} spinning={checking} /></button>} />
    <p className="group-label">RPC providers</p>
    <div className="group">
      {list.map((network) => {
        const custom = preferences.rpc[network.id]
        const status: Health = preferences.offline ? { state: 'paused' } : health[network.id] ?? { state: 'checking' }
        return <button key={network.id} className="row network-row" onClick={() => edit(network)}>
          <Coin chain={network.chain} />
          <span className="row-text">
            <strong>{network.name}{custom && <span className="network-badge">Custom</span>}</strong>
            <small>{custom ? new URL(custom).host : 'Still gateway'}</small>
          </span>
          <span className={`network-status network-status--${status.state}`}>
            <span className="network-dot" />
            {status.state === 'ok' ? `${status.ms} ms` : status.state === 'down' ? 'Offline' : status.state === 'paused' ? 'Paused' : 'Checking'}
          </span>
          <ChevronRight size={18} className="row-chevron" />
        </button>
      })}
    </div>
    <div className="network-note"><Info size={16} /><p>The Still gateway and its chain provider can see your network requests. A custom RPC connects straight from your browser to the provider you choose. Tap a network to change it.</p></div>
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
    setError('')
    setResult('')
    setTesting(true)
    const controller = new AbortController()
    request.current = controller
    try {
      await test(network, endpoint.trim() ? validateEndpoint(endpoint.trim()) : defaultEndpoint(network), controller.signal)
      if (!controller.signal.aborted) setResult(`Connected to ${network.name} ${network.label}.`)
    } catch {
      if (!controller.signal.aborted) setError('Connection failed. Check the URL, browser CORS access, and network.')
    } finally {
      if (!controller.signal.aborted) setTesting(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try { save(endpoint.trim() ? validateEndpoint(endpoint.trim()) : undefined) }
    catch { setError('Enter a valid HTTPS RPC URL or a local HTTP endpoint.') }
  }

  return <Dialog title={`${network.name} RPC`} close={close}>
    <form className="form" onSubmit={submit}>
      <p className="dialog-intro">Set a browser-accessible {network.chain === 'bitcoin' ? 'Esplora API' : network.chain === 'monero' ? 'Monero daemon (monerod) RPC' : 'JSON-RPC endpoint'} for {network.name} {network.label}. Leave it blank to use the Still gateway.</p>
      <label className="field">Custom RPC URL<input value={endpoint} placeholder={network.rpc} maxLength={2048} inputMode="url" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} onChange={(event) => { request.current?.abort(); setTesting(false); setEndpoint(event.target.value); setResult(''); setError('') }} /></label>
      <Slot open={offline}><Notice>Network requests are paused in Settings.</Notice></Slot>
      <ErrorSlot error={error} />
      <Slot open={!!result}><p className="success" role="status">{result}</p></Slot>
      <div className="two-actions"><button type="button" className="button secondary" onClick={() => void testConnection()} disabled={offline || testing}><span key={String(testing)} className="label-swap">{testing ? 'Connecting…' : 'Test connection'}</span></button><button className="button primary" type="submit">Save endpoint</button></div>
    </form>
  </Dialog>
}

function Setting({ icon, title, detail, children }: { icon: ReactNode; title: string; detail?: string; children: ReactNode }) {
  return <div className="row"><span className="row-icon">{icon}</span><span className="row-text"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{children}</div>
}

export function SettingsPage({ name, rename, preferences, update, mode, lock, remove, setup, protect, credits, leave }: {
  name: string; rename: () => void; preferences: Preferences; update: (value: Partial<Preferences>) => boolean; mode: 'none' | 'locked' | 'wallet'; lock: () => void;
  remove: () => void; setup: () => void; protect: () => void; credits: () => void
  /** Confirm before leaving for the ow2 About page or Discord. */
  leave: (to: 'about' | 'discord') => void
}) {
  // One stagger for the whole page.
  const page = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    page.current!.querySelectorAll<HTMLElement>('.group-label, .group > *').forEach((element, index) => { element.style.animationDelay = `${index * 17.5}ms` })
  }, [])
  return <div ref={page} className="page settings-page">
    <Heading title="Settings" />
    <p className="group-label">Privacy</p>
    <div className="group">
      <Setting icon={<EyeOff size={19} />} title="Hide balances" detail="Mask amounts across the app">
        <button className="toggle" type="button" role="switch" aria-label="Hide balances" aria-checked={preferences.hide} onClick={() => update({ hide: !preferences.hide })}><span /></button>
      </Setting>
      <Setting icon={<WifiOff size={19} />} title="Pause network requests" detail="Receive addresses stay available">
        <button className="toggle" type="button" role="switch" aria-label="Pause network requests" aria-checked={preferences.offline} onClick={() => update({ offline: !preferences.offline })}><span /></button>
      </Setting>
      <Setting icon={<ShieldAlert size={19} />} title="Account protection" detail="Erase this wallet after 5 wrong passwords">
        <button className="toggle" type="button" role="switch" aria-label="Account protection" aria-checked={preferences.protect} onClick={protect}><span /></button>
      </Setting>
      <Setting icon={<Coins size={19} />} title="Currency">
        <Picker compact label="Display currency" value={preferences.currency} onChange={(currency: Currency) => update({ currency })}
          options={currencies.map((code) => ({ value: code, label: code.toUpperCase() }))} />
      </Setting>
      <Setting icon={<LockKeyhole size={19} />} title="Auto-lock">
        <Picker compact label="Auto-lock interval" value={preferences.autoLock} onChange={(autoLock: number) => update({ autoLock })}
          options={[[0, 'Instant'], [1, '1 min'], [5, '5 min'], [15, '15 min'], [30, '30 min']].map(([value, label]) => ({ value: value as number, label: label as string }))} />
      </Setting>
    </div>
    <p className="group-label">This device</p>
    <div className="group">
      {mode === 'wallet' && <button className="row" onClick={rename}><span className="row-icon"><Pencil size={19} /></span><span className="row-text"><strong>Wallet name</strong><small>{name}</small></span><ChevronRight size={18} className="row-chevron" /></button>}
      <button className="row" onClick={mode === 'wallet' ? lock : setup}><span className="row-icon"><KeyRound size={19} /></span><span className="row-text"><strong>{mode === 'none' ? 'Set up wallet' : mode === 'locked' ? 'Unlock wallet' : 'Lock wallet'}</strong><small>{mode === 'none' ? 'Create or restore a wallet' : 'Vault is password protected'}</small></span><ChevronRight size={18} className="row-chevron" /></button>
      <a className="row" href="#networks"><span className="row-icon"><Globe2 size={19} /></span><span className="row-text"><strong>Networks</strong><small>RPC providers</small></span><ChevronRight size={18} className="row-chevron" /></a>
      {mode === 'wallet' && <button className="row" onClick={remove}><span className="row-icon danger-text"><Trash2 size={19} /></span><span className="row-text"><strong className="danger-text">Delete wallet</strong><small>Erase all wallets and data from this browser</small></span><ChevronRight size={18} className="row-chevron" /></button>}
    </div>
    <p className="group-label">About</p>
    <div className="group">
      <button className="row" onClick={() => leave('about')}><span className="row-icon"><Info size={19} /></span><span className="row-text"><strong>About ow2</strong></span><ExternalLink size={16} className="row-chevron" /></button>
      <button className="row" onClick={() => leave('discord')}><span className="row-icon"><MessageCircle size={19} /></span><span className="row-text"><strong>Discord</strong></span><ExternalLink size={16} className="row-chevron" /></button>
      <a className="row" href="#faq"><span className="row-icon"><CircleHelp size={19} /></span><span className="row-text"><strong>FAQ</strong></span><ChevronRight size={18} className="row-chevron" /></a>
      <a className="row" href="#privacy"><span className="row-icon"><ShieldCheck size={19} /></span><span className="row-text"><strong>Privacy Policy</strong></span><ChevronRight size={18} className="row-chevron" /></a>
      <button className="row" onClick={credits}><span className="row-icon"><Heart size={19} /></span><span className="row-text"><strong>Credits</strong></span><ChevronRight size={18} className="row-chevron" /></button>
    </div>
    <p className="version">Still Wallet by ow2</p>
  </div>
}
