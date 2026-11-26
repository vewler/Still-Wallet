import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { Dialog, ErrorSlot, Notice, PasswordInput } from './Dialog'
import type { Session } from '../vault'
import { walletIds } from '../storage'
import { t } from '../i18n'
import { copySecret } from '../clipboard'

/** Warning, then the password (never Face ID alone), then the words. Blurred until tapped, gone the moment the app leaves the screen. */
export function RecoveryPhrase({ session, close }: { session: Session; close: () => void }) {
  const [step, setStep] = useState<'warn' | 'verify' | 'show'>('warn')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState<boolean>()
  const closeRef = useRef(close)
  closeRef.current = close

  // Switching apps or tabs closes the sheet, so the words never sit on screen in the background or the app switcher.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') { setShown(false); setPhrase(''); closeRef.current() } }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', hide)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', hide) }
  }, [])
  // Drop the words from memory when the sheet goes.
  useEffect(() => () => setPhrase(''), [])

  function fail(problem: unknown, fallback: string) {
    const message = problem instanceof Error ? problem.message : fallback
    if (message === 'Cancelled') return
    setError(message)
    setTries((value) => value + 1)
  }

  function reveal(verified: Session) {
    if (verified.vault !== session.vault) throw new Error('The saved wallet changed. Try again.')
    setPassword('')
    setError('')
    // The words of the wallet that's open, its own phrase if it has one.
    setPhrase(session.mnemonic)
    setStep('show')
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const { unlockVault } = await import('../vault')
      reveal(await unlockVault(password))
    } catch (problem) {
      fail(problem, 'Incorrect password')
      if (problem instanceof Error && problem.message === 'Incorrect password') setPassword('')
    } finally { setBusy(false) }
  }

  async function copy() {
    try { await copySecret(phrase); setCopied(true) } catch { setCopied(false) }
  }

  const words = phrase.split(' ')
  const title = step === 'warn' ? t('Show recovery phrase?') : step === 'verify' ? t('Confirm it’s you') : t('Recovery phrase')

  return <Dialog title={title} step={step} close={close} busy={busy}>
    {step === 'warn' && <div className="form">
      <span className="empty-icon"><ShieldAlert size={25} /></span>
      <p className="dialog-intro dialog-intro--center">{t('Your recovery phrase is the only key to your funds. Anyone who sees it can take everything in this wallet.')}</p>
      <ul className="phrase-rules">
        <li>{t('Make sure nobody can see your screen.')}</li>
        <li>{t('Never share it or type it into a website. Still Wallet will never ask for it.')}</li>
        <li>{t('Write it on paper and keep it somewhere private.')}</li>
      </ul>
      <div className="two-actions"><button className="button primary" onClick={close} autoFocus>{t('Cancel')}</button><button className="button secondary" onClick={() => { setError(''); setStep('verify') }}>{t('Continue')}</button></div>
    </div>}
    {step === 'verify' && <form className="form" autoComplete="off" onSubmit={verify}>
      <p className="dialog-intro">{t('Enter your wallet password to show your recovery phrase.')}</p>
      <label className={error ? 'field field--wrong' : 'field'}>{t('Wallet pass⁠word')}<PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} autoFocus /></label>
      <ErrorSlot error={error} attempt={tries} />
      <div className="two-actions"><button className="button primary" type="button" onClick={close} disabled={busy}>{t('Cancel')}</button><button className="button secondary" type="submit" disabled={busy || !password}><span key={String(busy)} className="label-swap">{busy ? t('Checking…') : t('Show phrase')}</span></button></div>
    </form>}
    {step === 'show' && <div className="form">
      <p className="dialog-intro">{session.slot >= 100 ? t('Write down these words in order. This phrase restores this wallet.')
        : walletIds(session.vault).some((entry) => entry.account >= 100) ? t('Write down these words in order. This phrase restores every wallet made with it.')
        : t('Write down these words in order. This phrase restores every wallet in Still Wallet.')}</p>
      <div className={shown ? 'phrase-cover phrase-cover--shown' : 'phrase-cover'}>
        <ol className="phrase-grid" aria-label={t('Recovery phrase')} aria-hidden={!shown}>{words.map((word, index) => <li key={index}><span>{index + 1}</span>{shown ? word : '•••••'}</li>)}</ol>
        {!shown && <button type="button" className="phrase-reveal" onClick={() => setShown(true)}><Eye size={18} />{t('Tap to reveal')}</button>}
      </div>
      <Notice>{t('Copied words stay on your clipboard for 1 minute, then Still Wallet clears it.')}</Notice>
      <div className="two-actions">
        <button className="button secondary" onClick={() => setShown((value) => !value)}><span key={String(shown)} className="label-swap">{shown ? <EyeOff size={17} /> : <Eye size={17} />}{shown ? t('Hide') : t('Show')}</span></button>
        <button className="button secondary" onClick={() => void copy()}><span key={String(!!copied)} className="label-swap">{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? t('Copied') : t('Copy')}</span></button>
      </div>
      <ErrorSlot error={copied === false ? t('Copy isn’t allowed here. Write the words down instead.') : ''} />
      <button className="button primary wide" onClick={close}>{t('Done')}</button>
    </div>}
  </Dialog>
}
