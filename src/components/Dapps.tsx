import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { ArrowLeft, ClipboardPaste, Link2, LoaderCircle, ScanLine, Unplug } from 'lucide-react'
import { Dialog, ErrorSlot, Notice } from './Dialog'
import { t } from '../i18n'
import { networks, type Network } from '../networks'
import type { Session } from '../vault'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import * as wc from '../walletconnect'
import { currentPrompts, currentSessions, evmNetworks, hostOf, networkForChain, sessionAccount, solanaChain, subscribe, walletConnectUsed, walletKit, type Prompt } from '../walletconnect'

/** Plain errors only, library errors (viem dumps request bodies) get a short line. */
const message = (problem: unknown, fallback = 'Something went wrong. Try again.') => {
  const text = problem instanceof Error ? problem.message : ''
  if (!text) return t(fallback)
  if (text.length > 160 || /HTTP|Details:|Version:|fetch|network error/i.test(text)) return t('Couldn’t reach the network. Check your connection and try again.')
  return t(text)
}
const short = (value: string) => value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value
const shortAddress = (value: string) => value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value

/** Slide a sheet out the same way as its X button. */
function slideOut(holder: HTMLElement | null, done: () => void) {
  const dialogs = holder?.querySelectorAll('dialog[open]')
  const dialog = dialogs?.[dialogs.length - 1]
  if (!dialog) { done(); return }
  dialog.classList.add('dialog--closing')
  window.setTimeout(done, 280)
}

/** Letter tile instead of the app's own icon, so opening a prompt never loads anything from the app's server. */
function AppMark({ name }: { name: string }) {
  return <span className="dapp-mark" aria-hidden="true">{(name.trim()[0] ?? '?').toUpperCase()}</span>
}

function AppHeader({ name, url }: { name: string; url: string }) {
  return <div className="dapp-head">
    <AppMark name={name} />
    <span><strong>{name || t('Unnamed app')}</strong><small className="mono">{hostOf(url)}</small></span>
  </div>
}

/** Reconnects saved sessions after unlock, only for people who use connected apps. */
export function useDapps(enabled: boolean) {
  const prompts = useSyncExternalStore(subscribe, currentPrompts)
  const sessions = useSyncExternalStore(subscribe, currentSessions)
  useEffect(() => {
    if (enabled && walletConnectUsed()) walletKit().catch(() => {})
  }, [enabled])
  return { prompts, sessions }
}

/** Settings > Connected apps: connect with a link or QR code, see and end sessions. */
export function ConnectedApps({ close, offline, initialLink = '' }: { close: () => void; offline: boolean; initialLink?: string }) {
  const sessions = useSyncExternalStore(subscribe, currentSessions)
  const [link, setLink] = useState(initialLink)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(!offline)
  const [scanning, setScanning] = useState(false)
  // After the camera failed once, the next try opens it before leaving the list, so a repeat failure keeps the error still.
  const cameraFailed = useRef(false)
  const [camera, setCamera] = useState<MediaStream>()
  const [ending, setEnding] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (offline) return
    walletKit().then(() => setLoading(false), (problem) => { setLoading(false); setError(message(problem)) })
  }, [offline])

  async function connect(value = link) {
    if (busy) return
    setBusy(true)
    try {
      const { pair } = wc
      await pair(value)
      setError('')
      setLink('')
    } catch (problem) {
      setError(message(problem))
      setTries((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  // A link opened from another app connects right away.
  useEffect(() => {
    if (!initialLink || started.current || offline) return
    started.current = true
    void connect(initialLink)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function scan() {
    if (!cameraFailed.current) { setError(''); setScanning(true); return }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      cameraFailed.current = false
      setError('')
      setCamera(media)
      setScanning(true)
    } catch {
      setError(t('Couldn’t open the camera. Allow camera access, or paste the link instead.'))
      setTries((count) => count + 1)
    }
  }

  async function end(topic: string) {
    setEnding(topic)
    try {
      const { disconnect } = wc
      await disconnect(topic)
    } catch { /* The list refreshes either way. */ } finally {
      setEnding('')
    }
  }

  if (offline) return <Dialog title={t('Connected apps')} close={close}>
    <div className="form"><span className="empty-icon"><Unplug size={24} /></span>
      <p className="dialog-intro dialog-intro--center">{t('Network requests are paused. Turn them back on in Settings to connect apps.')}</p>
      <button className="button primary wide" onClick={close}>{t('Done')}</button>
    </div>
  </Dialog>

  return <Dialog title={scanning ? t('Scan QR code') : t('Connected apps')} step={scanning ? 'scan' : 'list'} close={close} busy={busy}>
    {scanning ? <div className="form">
      <Scanner stream={camera} found={(value) => { setScanning(false); setCamera(undefined); setLink(value); void connect(value) }} failed={(problem) => { cameraFailed.current = true; setScanning(false); setCamera(undefined); setError(problem); setTries((count) => count + 1) }} />
      <p className="field-note">{t('Point the camera at the WalletConnect QR code on the app’s site.')}</p>
      <button className="button text-button wide" onClick={() => { setScanning(false); setCamera(undefined) }}><ArrowLeft size={16} /> Back</button>
    </div> : <form className="form" onSubmit={(event: FormEvent) => { event.preventDefault(); void connect() }}>
      <p className="dialog-intro">{t('Use Still with apps and sites that support WalletConnect. Pick WalletConnect in the app, then scan its QR code or paste its link.')}</p>
      <label className="field">{t('WalletConnect link')}
        <span className="input-row">
          <input className="mono" name="link" placeholder="wc:…" value={link} onChange={(event) => setLink(event.target.value)} autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={600} />
          <button type="button" className="input-action" aria-label={t('Paste link')} onClick={async () => {
            try { const text = await navigator.clipboard.readText(); if (text) setLink(text.trim()) } catch { setError(t('Paste isn’t allowed here. Long-press the field and paste instead.')); setTries((count) => count + 1) }
          }}><ClipboardPaste size={18} /></button>
        </span>
      </label>
      <ErrorSlot error={error} attempt={tries} />
      <div className="two-actions">
        <button type="button" className="button secondary" onClick={() => void scan()} disabled={busy || loading}><ScanLine size={17} /> Scan</button>
        <button type="submit" className="button primary" disabled={busy || loading || !link.trim()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Link2 size={17} />} Connect</button>
      </div>
      <p className="group-label dapp-label">{loading ? t('Loading…') : sessions.length ? t('Connected') : t('No apps connected')}</p>
      {sessions.length > 0 && <ul className="credits-list dapp-list">
        {sessions.map((session) => <li key={session.topic}>
          <AppMark name={session.peer.metadata.name} />
          <span><strong>{session.peer.metadata.name || t('Unnamed app')}</strong><small className="mono">{hostOf(session.peer.metadata.url)}</small></span>
          <button type="button" className="button secondary pill" onClick={() => void end(session.topic)} disabled={ending === session.topic}>{ending === session.topic ? <LoaderCircle size={15} className="spin" /> : t('Disconnect')}</button>
        </li>)}
      </ul>}
      <p className="field-note">{t('Apps only see your public address. Still asks you before anything gets signed or sent.')}</p>
    </form>}
  </Dialog>
}

/** Camera QR reader. jsQR runs on-device, nothing leaves the phone. */
function Scanner({ stream: opened, found, failed }: { stream?: MediaStream; found: (value: string) => void; failed: (problem: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let stream: MediaStream | undefined = opened
    let frame = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
        const [{ default: jsQR }, media] = await Promise.all([import('jsqr'), opened ?? navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })])
        stream = media
        if (stopped) { media.getTracks().forEach((track) => track.stop()); return }
        const element = video.current!
        element.srcObject = media
        await element.play()
        let last = 0
        const tick = (time: number) => {
          if (stopped) return
          frame = requestAnimationFrame(tick)
          if (time - last < 150 || !element.videoWidth || !context) return
          last = time
          const scale = Math.min(1, 640 / element.videoWidth)
          canvas.width = Math.round(element.videoWidth * scale)
          canvas.height = Math.round(element.videoHeight * scale)
          context.drawImage(element, 0, 0, canvas.width, canvas.height)
          const code = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })
          if (code?.data.startsWith('wc:')) { stopped = true; found(code.data) }
        }
        frame = requestAnimationFrame(tick)
      } catch {
        if (!stopped) failed(t('Couldn’t open the camera. Allow camera access, or paste the link instead.'))
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className="scan-frame"><video ref={video} muted playsInline aria-label={t('Camera preview')} /><span aria-hidden="true" /></div>
}

export type DappWallet = {
  session: Session
  name: string
  prepareDapp: (network: Network, from: string, call: { to?: string; value?: string; data?: `0x${string}` }, app: string, signal: AbortSignal) => Promise<Quote>
  withEndpoint: <T>(network: Network, signal: AbortSignal, task: (endpoint: string, wallet: Session, signal: AbortSignal) => Promise<T>) => Promise<T>
  submit: (quote: Quote) => Promise<ActivityItem>
  notify: (message: string) => void
}

const chainSwitches = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain'])

/** Shows app requests one at a time, on top of whatever is open. */
export function DappPrompts({ prompts, wallet }: { prompts: Prompt[]; wallet: DappWallet }) {
  const prompt = prompts[0]
  // Chain switches need no confirmation, the session already covers every network Still has.
  useEffect(() => {
    if (prompt?.kind !== 'request') return
    const { method, params } = prompt.event.params.request
    void Promise.resolve(wc).then(({ respond, fail, dismiss, evmMethods, solanaMethods }) => {
      if (chainSwitches.has(method)) {
        const id = Number((params as [{ chainId?: string }])?.[0]?.chainId)
        if (evmNetworks.has(id)) void respond(prompt, null).catch(() => {}).finally(() => dismiss(prompt))
        else void fail(prompt, 4902, 'Still doesn’t support this network.')
      } else if (!evmMethods.includes(method) && !solanaMethods.includes(method)) {
        void fail(prompt, 4200, 'Still doesn’t support this request.')
      }
    })
  }, [prompt])
  if (!prompt || (prompt.kind === 'request' && chainSwitches.has(prompt.event.params.request.method))) return null
  return <PromptSheet key={`${prompt.kind}-${prompt.event.id}`} prompt={prompt} wallet={wallet} />
}

function PromptSheet({ prompt, wallet }: { prompt: Prompt; wallet: DappWallet }) {
  const holder = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const finished = useRef(false)

  /** Slide away, then show the next prompt. */
  function leave() {
    finished.current = true
    slideOut(holder.current, () => wc.dismiss(prompt))
  }
  /** X, Esc and backdrop already slid the sheet away. */
  async function cancel(slide = false) {
    if (finished.current) return
    finished.current = true
    const { reject, dismiss } = wc
    void reject(prompt)
    if (slide) slideOut(holder.current, () => dismiss(prompt))
    else dismiss(prompt)
  }
  async function run(task: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await task(); setError('') } catch (problem) { setError(message(problem)); setTries((count) => count + 1) } finally { setBusy(false) }
  }

  return <div ref={holder}>{prompt.kind === 'proposal'
    ? <ProposalSheet prompt={prompt} wallet={wallet} busy={busy} error={error} tries={tries} cancel={cancel} approve={() => run(async () => {
      const { approve } = wc
      await approve(prompt, wallet.session.addresses)
      wallet.notify(t('Connected to {app}', { app: prompt.event.params.proposer.metadata.name || t('app') }))
      leave()
    })} />
    : <RequestSheet prompt={prompt} wallet={wallet} busy={busy} error={error} tries={tries} cancel={cancel} run={run} leave={leave} />}
  </div>
}

type SheetProps = { wallet: DappWallet; busy: boolean; error: string; tries: number; cancel: (slide?: boolean) => Promise<void> }

function Verification({ context }: { context?: { verified?: { validation?: string; isScam?: boolean } } }) {
  const verified = context?.verified
  if (verified?.isScam) return <Notice error>{t('This site is flagged as a scam. Don’t connect or sign anything.')}</Notice>
  if (verified?.validation === 'INVALID') return <Notice error>{t('This site’s address doesn’t match the app it claims to be. It could be an imitation.')}</Notice>
  if (verified?.validation === 'VALID') return null
  return <p className="field-note">{t('Still couldn’t verify this site. Check the address above is the one you meant to use.')}</p>
}

function ProposalSheet({ prompt, wallet, busy, error, tries, cancel, approve }: SheetProps & { prompt: Prompt & { kind: 'proposal' }; approve: () => void }) {
  const { proposer, requiredNamespaces, optionalNamespaces } = prompt.event.params
  const chains = [...new Set(Object.entries({ ...optionalNamespaces, ...requiredNamespaces }).flatMap(([key, value]) => value.chains ?? (key.includes(':') ? [key] : [])))]
  const named = [...new Set(chains.map((chain) => networkForChain(chain)?.name).filter(Boolean))]
  const solana = chains.some((chain) => chain.startsWith('solana:'))
  return <Dialog title={t('Connect to app')} close={() => void cancel()} busy={busy}>
    <div className="form">
      <AppHeader name={proposer.metadata.name} url={proposer.metadata.url} />
      <Verification context={prompt.event.verifyContext} />
      <dl className="review-list">
        <div><dt>{t('Wallet')}</dt><dd>{wallet.name || t('Wallet')}</dd></div>
        <div><dt>{t('Address')}</dt><dd className="mono">{short(wallet.session.addresses.ethereum)}</dd></div>
        {solana && <div><dt>{t('Solana')}</dt><dd className="mono">{short(wallet.session.addresses.solana)}</dd></div>}
        {named.length > 0 && <div><dt>{t('Networks')}</dt><dd>{named.length > 3 ? t('{names} and {count} more', { names: named.slice(0, 3).join(', '), count: named.length - 3 }) : named.join(', ')}</dd></div>}
      </dl>
      <Notice>{t('The app will see your address and balances. It can ask you to sign or send, Still always shows you first.')}</Notice>
      <ErrorSlot error={error} attempt={tries} />
      <button className="button primary wide" onClick={approve} disabled={busy}>{busy ? t('Connecting…') : t('Connect')}</button>
      <button className="button text-button wide" onClick={() => void cancel(true)} disabled={busy}>{t('Cancel')}</button>
    </div>
  </Dialog>
}

function RequestSheet({ prompt, wallet, busy, error, tries, cancel, run, leave }: SheetProps & { prompt: Prompt & { kind: 'request' }; run: (task: () => Promise<void>) => Promise<void>; leave: () => void }) {
  const { request, chainId } = prompt.event.params
  const { method, params } = request
  const session = currentSessions().find((entry) => entry.topic === prompt.event.topic)
  const app = session?.peer.metadata ?? { name: 'App', url: '' }
  const network = networkForChain(chainId)
  const solana = chainId.startsWith('solana:') || method.startsWith('solana_')
  const mine = solana ? wallet.session.addresses.solana : wallet.session.addresses.ethereum
  const approved = sessionAccount(prompt.event.topic, solana ? solanaChain : chainId)
  const otherWallet = Boolean(approved && approved.toLowerCase() !== mine.toLowerCase())
  const [details, setDetails] = useState<Awaited<ReturnType<typeof describe>>>()
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)

  async function describe(signal: AbortSignal) {
    const dapps = await import('../dapps')
    if (method === 'personal_sign') {
      const { message: text, address } = dapps.personalParams(params)
      if (address && address.toLowerCase() !== mine.toLowerCase()) throw new Error('This request is for a different address.')
      return { kind: 'message' as const, text: dapps.readableMessage(text) }
    }
    if (method === 'solana_signMessage') return { kind: 'message' as const, text: dapps.solanaMessage(params).text }
    if (method.startsWith('eth_signTypedData')) {
      const { data, address } = dapps.typedParams(params)
      if (address && address.toLowerCase() !== mine.toLowerCase()) throw new Error('This request is for a different address.')
      return { kind: 'typed' as const, data, permit: dapps.isPermit(data) }
    }
    if (method === 'eth_sendTransaction') {
      if (!network || network.chain === 'solana') throw new Error('Still doesn’t support this network.')
      const call = dapps.callParams(params)
      if (call.from && call.from.toLowerCase() !== mine.toLowerCase()) throw new Error('This request is for a different address.')
      const quote = await wallet.prepareDapp(network, mine, call, app.name || hostOf(app.url), signal)
      return { kind: 'transaction' as const, quote, call: dapps.describeCall(call, network.chainId!) }
    }
    const list = dapps.solanaTransactions(method, params)
    const solanaNetwork = networks['solana-main']
    const preview = list.length === 1 ? await wallet.withEndpoint(solanaNetwork, signal, (endpoint, _session, request) => dapps.previewSolana(mine, endpoint, list[0], request)).catch(() => undefined) : undefined
    return { kind: 'solana' as const, count: list.length, preview, change: preview?.change === undefined ? undefined : dapps.formatLamports(preview.change) }
  }

  useEffect(() => {
    if (otherWallet) return
    const controller = new AbortController()
    describe(controller.signal).then(setDetails, (problem) => { if (!controller.signal.aborted) setLoadError(message(problem, 'Couldn’t read this request.')) })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  async function confirm() {
    await run(async () => {
      const dapps = await import('../dapps')
      let result: unknown
      if (details?.kind === 'transaction') {
        const item = await wallet.submit(details.quote)
        result = item.hash
      } else if (method === 'personal_sign') result = await dapps.signPersonal(wallet.session, params)
      else if (method.startsWith('eth_signTypedData')) result = await dapps.signTyped(wallet.session, params)
      else if (method === 'solana_signMessage') result = await dapps.signSolanaMessage(wallet.session, params)
      else result = await wallet.withEndpoint(networks['solana-main'], AbortSignal.timeout(30_000), (endpoint, session, signal) => dapps.signSolana(session, method, params, endpoint, signal))
      await wc.respond(prompt, result)
      wallet.notify(details?.kind === 'transaction' || method === 'solana_signAndSendTransaction' ? t('Transaction sent') : t('Signed'))
      leave()
    })
  }

  const sends = method === 'eth_sendTransaction' || method === 'solana_signAndSendTransaction'
  const title = details?.kind === 'message' ? t('Sign message') : details?.kind === 'typed' ? t('Sign data') : sends ? t('Review transaction') : t('Sign transaction')
  const blocked = otherWallet || Boolean(loadError)
  return <Dialog title={title} close={() => void cancel()} busy={busy}>
    <div className="form">
      <AppHeader name={app.name} url={app.url} />
      {otherWallet ? <Notice error>{t('This app is connected to a different wallet. Switch to that wallet in Still, then try again in the app.')}</Notice>
        : loadError ? <Notice error>{loadError}</Notice>
        : !details ? <div className="dapp-loading"><LoaderCircle size={22} className="spin" /> Checking request…</div>
        : details.kind === 'message' ? <>
          <pre className="sign-box">{details.text}</pre>
          <Notice>{t('Signing proves you own this wallet. It doesn’t send coins.')}</Notice>
        </> : details.kind === 'typed' ? <>
          <dl className="review-list">
            {typeof details.data.domain?.name === 'string' && <div><dt>{t('Contract')}</dt><dd>{details.data.domain.name}</dd></div>}
            {details.data.domain?.chainId !== undefined && <div><dt>{t('Network')}</dt><dd>{evmNetworks.get(Number(details.data.domain.chainId))?.name ?? t('Chain {id}', { id: String(details.data.domain.chainId) })}</dd></div>}
            <div><dt>{t('Type')}</dt><dd>{details.data.primaryType}</dd></div>
          </dl>
          <pre className="sign-box">{JSON.stringify(details.data.message, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}</pre>
          {details.permit ? <Notice error>{t('This is a token permit. It lets someone move your tokens later without asking again. Only sign on sites you trust.')}</Notice> : <Notice>{t('Signing doesn’t send coins by itself, but apps can use signatures to act for you. Only sign on sites you trust.')}</Notice>}
        </> : details.kind === 'transaction' ? <>
          <dl className="review-list">
            <div><dt>{t('Network')}</dt><dd>{details.quote.network.name} · {details.quote.network.label}</dd></div>
            <div><dt>{details.call ? 'Contract' : 'Recipient'}</dt><dd className="mono">{shortAddress(details.quote.to)}</dd></div>
            {details.call?.kind === 'approve' && <><div><dt>{t('Action')}</dt><dd>{t(details.call.label)}</dd></div><div><dt>{t('Spender')}</dt><dd className="mono">{shortAddress(details.call.spender)}</dd></div><div><dt>{t('Limit')}</dt><dd>{['Unlimited', 'All items', 'Removed'].includes(details.call.amount) ? t(details.call.amount) : details.call.amount}</dd></div></>}
            {details.call?.kind === 'transfer' && <><div><dt>{t('Action')}</dt><dd>{t(details.call.label)}</dd></div><div><dt>{t('To')}</dt><dd className="mono">{shortAddress(details.call.to)}</dd></div><div><dt>{t('Amount')}</dt><dd>{['Unlimited', 'All items', 'Removed'].includes(details.call.amount) ? t(details.call.amount) : details.call.amount}</dd></div></>}
            {details.call?.kind === 'call' && <div><dt>{t('Action')}</dt><dd>{t(details.call.label)}</dd></div>}
            <div><dt>{t('You send')}</dt><dd>{details.quote.value} {details.quote.network.symbol}</dd></div>
            <div><dt>{t('Network fee estimate')}</dt><dd>{details.quote.fee} {details.quote.network.symbol}</dd></div>
          </dl>
          {details.call?.kind === 'approve' ? <Notice error>{details.call.amount === 'Removed' ? t('This removes an app’s permission.') : t(details.call.amount === 'Unlimited' ? 'This lets {spender} move all your {token} with no limit. Only approve on sites you trust.' : 'This lets {spender} move your {token}. Only approve on sites you trust.', { spender: shortAddress(details.call.spender), token: details.call.token ?? t('tokens') })}</Notice>
            : <Notice>{t('This is a mainnet transaction. Once sent it can’t be recalled.')}</Notice>}
        </> : <>
          <dl className="review-list">
            <div><dt>{t('Network')}</dt><dd>{t('Solana')}</dd></div>
            {details.count > 1 && <div><dt>{t('Transactions')}</dt><dd>{details.count}</dd></div>}
            {details.change !== undefined && <div><dt>{t('SOL change')}</dt><dd>{details.change}</dd></div>}
          </dl>
          {details.preview?.fails ? <Notice error>{t('A test run of this transaction failed. It will probably fail on chain too.')}</Notice>
            : <Notice>{t('Still can’t show every detail of Solana app transactions, only the SOL change. Only approve on sites you trust.')}</Notice>}
        </>}
      <ErrorSlot error={error} attempt={tries} />
      {loadError && !otherWallet && <button className="button primary wide" onClick={() => { setLoadError(''); setAttempt((count) => count + 1) }}>{t('Try again')}</button>}
      {!blocked && <button className="button primary wide" onClick={() => void confirm()} disabled={busy || !details || (details.kind === 'transaction' && Date.now() > details.quote.expires + 60_000)}>{busy ? sends ? t('Sending…') : t('Signing…') : sends ? t('Sign and send') : t('Sign')}</button>}
      <button className={otherWallet ? 'button primary wide' : 'button text-button wide'} onClick={() => void cancel(true)} disabled={busy}>{blocked ? t('Reject') : t('Cancel')}</button>
    </div>
  </Dialog>
}
