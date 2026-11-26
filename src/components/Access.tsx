import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, KeyRound, LoaderCircle, LockKeyhole, ShieldAlert, Trash2, Wallet, X } from 'lucide-react'
import type { Session } from '../vault'
import { passwordRules } from '../passwords'
import { failedUnlocks, forgetVault, maxUnlockAttempts, saveFailedUnlocks, savedVaultId } from '../storage'

// Crypto code is lazy loaded (prewarmed after first paint) to keep it out of the main bundle.
const vault = () => import('../vault')
import { Dialog, ErrorSlot, PasswordInput } from './Dialog'
import { t } from '../i18n'

type AccessStep = 'choose' | 'create' | 'verify' | 'import' | 'password' | 'unlock' | 'forgot' | 'recover' | 'reset' | 'erase' | 'done'
const order: AccessStep[] = ['choose', 'create', 'import', 'verify', 'password', 'unlock', 'forgot', 'recover', 'reset', 'erase', 'done']

export function Access({ locked, protect, intent, close, onSession, erased }: {
  locked: boolean; protect: boolean; intent?: 'send' | 'receive' | 'swap'; close: () => void; onSession: (session: Session) => void
  /** Account protection erased the wallet after too many wrong passwords. */
  erased: (message: string) => void
}) {
  const [step, setStep] = useState<AccessStep>(locked ? 'unlock' : 'choose')
  const [phrase, setPhrase] = useState('')
  const [answer, setAnswer] = useState('')
  const [wordIndex] = useState(() => Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * 12))
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [failures, setFailures] = useState(failedUnlocks)
  const [busy, setBusy] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [origin, setOrigin] = useState<'verify' | 'import'>('verify')
  const [back, setBack] = useState(false)
  // Unlock <-> forgot works like the lock screen: no slide, blue button label fades, text drops in from above, buttons rise from below.
  const [swapIn, setSwapIn] = useState(false)
  const fadeLabel = useRef(false)
  const fadeTitle = useRef(false)
  useEffect(() => {
    if (!swapIn) return
    const timer = window.setTimeout(() => setSwapIn(false), 420)
    return () => window.clearTimeout(timer)
  }, [swapIn])
  const swapTo = (next: 'unlock' | 'forgot' | 'recover') => {
    fadeLabel.current = next !== 'forgot'
    fadeTitle.current = true
    setError('')
    setPassword('')
    setPhrase('')
    setBack(false)
    setSwapIn(true)
    setStep(next)
  }

  const changeStep = (next: AccessStep) => {
    setError('')
    setPassword('')
    setConfirmation('')
    setBack(order.indexOf(next) < order.indexOf(step))
    setSwapIn(false)
    fadeTitle.current = false
    setStep(next)
  }

  // Errors stay until replaced, so a repeat shakes instead of reopening.
  const fail = (message: string) => { setError(message); setTries((value) => value + 1) }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    fadeLabel.current = false
    if (step === 'recover') {
      setBusy(true)
      try {
        await (await vault()).checkRecoveryPhrase(phrase)
        changeStep('reset')
      } catch (problem) {
        fail(problem instanceof Error ? problem.message : 'This recovery phrase doesn’t match this wallet.')
      } finally { setBusy(false) }
      return
    }
    if (step === 'reset') {
      if (!passwordRules.every((rule) => rule.test(password))) { fail('Your new password doesn’t meet all the requirements yet.'); return }
      if (password !== confirmation) { fail('The passwords do not match.'); return }
      setBusy(true)
      try {
        const session = await (await vault()).resetPassword(phrase, password)
        setPhrase('')
        try { saveFailedUnlocks(0) } catch { /* Counter reset is best effort. */ }
        setUnlocked(true)
        setTimeout(() => onSession(session), 650)
      } catch (problem) {
        fail(problem instanceof Error ? problem.message : 'The password could not be changed. Nothing was changed.')
      } finally { setBusy(false) }
      return
    }
    if (step === 'import') {
      if (!(await vault()).validPhrase(phrase)) { fail('Enter a valid English BIP-39 recovery phrase.'); return }
      setOrigin('import')
      changeStep('password')
      return
    }
    if (step === 'verify') {
      if ((await vault()).normalizePhrase(answer) !== phrase.split(' ')[wordIndex]) { fail('That word is different. Check your backup and try again.'); return }
      setAnswer('')
      setOrigin('verify')
      changeStep('password')
      return
    }
    if (step === 'password' && !passwordRules.every((rule) => rule.test(password))) {
      fail('Your password doesn’t meet all the requirements yet.')
      return
    }
    if (step === 'password' && password !== confirmation) {
      fail('The passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const { unlockVault, createVault } = await vault()
      const session = step === 'unlock' ? await unlockVault(password) : await createVault(phrase, password)
      // Same as the lock screen: open the padlock, then the wallet.
      if (step === 'unlock') {
        try { saveFailedUnlocks(0) } catch { /* Counter reset is best effort. */ }
        setUnlocked(true)
        setTimeout(() => onSession(session), 650)
        return
      }
      // Short success beat before the wallet opens.
      setBack(false)
      setStep('done')
      setTimeout(() => onSession(session), 900)
    } catch (problem) {
      fail(problem instanceof Error ? problem.message : 'The local wallet could not be opened.')
      if (problem instanceof Error && problem.message === 'Incorrect password') setPassword('')
      // Wrong passwords count here like on the lock screen, with the same stored counter.
      if (step !== 'unlock' || !protect || !(problem instanceof Error && problem.message === 'Incorrect password')) return
      const count = failedUnlocks() + 1
      try { saveFailedUnlocks(count) } catch { /* Still enforce within this session. */ }
      setFailures(count)
      if (count >= maxUnlockAttempts) await erase()
    } finally {
      setBusy(false)
    }
  }

  async function deleteWallet() {
    setBusy(true)
    try {
      await (await vault()).removeVault(savedVaultId() ?? '')
      try { forgetVault() } finally { erased('Wallet deleted') }
    } catch (problem) {
      fail(problem instanceof Error ? problem.message : 'The local wallet could not be removed.')
      setBusy(false)
    }
  }

  async function erase() {
    try {
      await (await vault()).removeVault(savedVaultId() ?? '')
      try { forgetVault() } finally { erased('Too many wrong passwords. Wallet erased') }
    } catch (problem) {
      fail(problem instanceof Error ? problem.message : 'The local wallet could not be removed.')
    }
  }

  const titles: Record<AccessStep, string> = {
    choose: t('Set up Still'), create: t('Back up your recovery phrase'), verify: t('Check your backup'),
    import: t('Import a wallet'), password: t('Set a password'), unlock: t('Unlock Still'), done: t('Wallet ready'),
    forgot: t('Forgot your password?'), recover: t('Enter your recovery phrase'), reset: t('Pick a new password'), erase: t('Delete wallet?'),
  }
  const swapClass = swapIn ? 'form lock-card--in' : 'form'

  return <Dialog title={titles[step]} step={step === 'forgot' || step === 'recover' ? 'unlock' : step} titleFade={fadeTitle.current} anchorBottom={swapIn} close={close} busy={busy || unlocked || step === 'done'} back={back}>
    {step === 'forgot' && <div className={swapClass}>
      {/* Invisible copy of the unlock text + field keeps the blue button exactly where Unlock was. */}
      <div className="swap-stack">
        <div className="swap-ghost" aria-hidden="true" inert><p className="dialog-intro">{t('Enter your password to open the encrypted vault on this device.')}</p><span className="field">{t('Pass\u2060word')}<span className="swap-ghost-input" /></span></div>
        <p className="dialog-intro">{t('Your recovery phrase sets a new password, nothing is lost. Deleting is final.')}</p>
      </div>
      <ErrorSlot error={error} attempt={tries} />
      <button type="button" className="button primary wide" onClick={() => swapTo('recover')}><span className="label-swap label-fade"><KeyRound size={17} />{t('Use recovery phrase')}</span></button>
      <div className="two-actions"><button type="button" className="button secondary" onClick={() => swapTo('unlock')}>{t('Cancel')}</button><button type="button" className="button secondary" onClick={() => changeStep('erase')}>{t('Delete wallet')}</button></div>
    </div>}
    {step === 'erase' && <div className="form"><span className="empty-icon"><Trash2 size={24} /></span>
      <p className="dialog-intro dialog-intro--center">{t('Are you sure you want to delete your wallet from Still Wallet on this device? You can only get it back with your recovery phrase.')}</p>
      <ErrorSlot error={error} attempt={tries} />
      <div className="two-actions"><button type="button" className="button primary" onClick={() => changeStep('forgot')} disabled={busy} autoFocus>{t('Cancel')}</button><button type="button" className="button secondary" onClick={() => void deleteWallet()} disabled={busy}><span key={String(busy)} className="label-swap">{busy ? t('Deleting…') : t('Delete wallet')}</span></button></div>
    </div>}
    {step === 'done' && <div className="setup-done">
      <span className="setup-done-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" /></svg></span>
      <strong>{t('You’re all set')}</strong>
      <p>{t('Your wallet is encrypted on this device.')}</p>
    </div>}
    {step === 'choose' && <>
      <p className="dialog-intro">{intent === 'send' ? t('Set up a wallet to send crypto on your chosen network.') : intent === 'receive' ? t('Set up a wallet to receive crypto on your chosen network.') : intent === 'swap' ? t('Set up a wallet to swap crypto on your chosen network.') : t('Create a new self-custody wallet or restore one from a recovery phrase.')}</p>
      <button type="button" className="choice" onClick={() => { void vault().then(({ newPhrase }) => { setPhrase(newPhrase()); changeStep('create') }) }}><span className="choice-icon"><Wallet size={22} /></span><span><strong>{t('Create a wallet')}</strong><small>{t('Generate a recovery phrase on this device.')}</small></span><ChevronRight size={18} /></button>
      <button type="button" className="choice" onClick={() => { setPhrase(''); changeStep('import') }}><span className="choice-icon"><Download size={22} /></span><span><strong>{t('Import a wallet')}</strong><small>{t('Restore from a BIP-39 recovery phrase.')}</small></span><ChevronRight size={18} /></button>
    </>}
    {step === 'create' && <>
      <p className="dialog-intro">{t('Write down these words in order and keep them somewhere private. Anyone with the phrase can access your funds.')}</p>
      <ol className="phrase-grid" aria-label={t('Recovery phrase')}>{phrase.split(' ').map((word, index) => <li key={index}><span>{index + 1}</span>{word}</li>)}</ol>
      <button type="button" className="button primary wide" onClick={() => changeStep('verify')}>{t('I’ve written it down')} <ArrowRight size={17} /></button>
      <button type="button" className="button text-button wide" onClick={() => { setPhrase(''); changeStep('choose') }}><ArrowLeft size={16} /> {t('Back to setup')}</button>
    </>}
    {step !== 'choose' && step !== 'create' && step !== 'done' && step !== 'forgot' && step !== 'erase' && <form className={step === 'unlock' || step === 'recover' ? swapClass : 'form'} autoComplete="off" onSubmit={submit}>
      {step === 'recover' && <>
        <p className="dialog-intro">{t('Type the words of this wallet in order. They stay on this device.')}</p>
        <label className={error ? 'field field--wrong' : 'field'}><textarea aria-label={t('Recovery phrase')} aria-invalid={!!error} value={phrase} onChange={(event) => setPhrase(event.target.value)} name="recovery-phrase" autoFocus required rows={4} maxLength={320} autoComplete="off" spellCheck={false} autoCapitalize="none" autoCorrect="off" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" /></label>
      </>}
      {step === 'reset' && <>
        <label className="field">{t('New pass\u2060word')}<PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required maxLength={256} aria-describedby="access-reset-rules" /></label>
        <ul className="password-rules" id="access-reset-rules" aria-live="polite">
          {passwordRules.map((rule) => { const met = rule.test(password); return <li key={rule.label} className={met ? 'met' : ''}>{met ? <Check size={14} /> : <X size={14} />}{t(rule.label)}</li> })}
        </ul>
        <label className="field">{t('Confirm pass\u2060word')}<PasswordInput value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={256} /></label>
      </>}
      {step === 'import' && <>
        <p className="dialog-intro">{t('Enter your English BIP-39 recovery phrase in order. Still derives the first account on each supported network.')}</p>
        <label className="field">{t('Recovery phrase')}<textarea value={phrase} onChange={(event) => setPhrase(event.target.value)} name="recovery-phrase" autoFocus required rows={4} maxLength={320} autoComplete="off" spellCheck={false} autoCapitalize="none" autoCorrect="off" /></label>
      </>}
      {step === 'verify' && <>
        <p className="dialog-intro">{t('Enter word {number} from the recovery phrase you wrote down.', { number: wordIndex + 1 })}</p>
        <label className="field">{t('Word {number}', { number: wordIndex + 1 })}<input value={answer} onChange={(event) => setAnswer(event.target.value)} autoFocus required maxLength={32} name="backup-word" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="next" /></label>
      </>}
      {(step === 'password' || step === 'unlock') && <>
        <p className="dialog-intro">{step === 'unlock' ? t('Enter your password to open the encrypted vault on this device.') : t('Your password encrypts this wallet in your browser.')}</p>
        <label className={step === 'unlock' && error ? 'field field--wrong' : 'field'}>{t('Pass⁠word')}<PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required maxLength={256} aria-describedby={step === 'password' ? 'password-rules' : undefined} /></label>
        {step === 'unlock' && protect && failures > 0 && (maxUnlockAttempts - failures === 1
          ? <p className="last-try" role="alert"><ShieldAlert size={18} /><span><strong>{t('Last try')}</strong>{t('One more wrong password erases this wallet.')}</span></p>
          : <p className="attempts-left">{t('{count} tries left before this wallet is erased', { count: maxUnlockAttempts - failures })}</p>)}
        {step === 'password' && <ul className="password-rules" id="password-rules" aria-live="polite">
          {passwordRules.map((rule) => { const met = rule.test(password); return <li key={rule.label} className={met ? 'met' : ''}>{met ? <Check size={14} /> : <X size={14} />}{t(rule.label)}</li> })}
        </ul>}
        {step === 'password' && <label className="field">{t('Confirm pass⁠word')}<PasswordInput value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={256} /></label>}
      </>}
      <ErrorSlot error={error} attempt={tries} />
      <button type="submit" className="button primary wide" disabled={busy || unlocked}>
        {unlocked ? <span key="open" className="label-swap"><LockKeyhole size={17} className="unlocking" />{t('Unlocked')}</span> : step === 'recover' || step === 'reset' ? <span key={String(busy)} className={fadeLabel.current && step === 'recover' && !busy ? 'label-swap label-fade' : 'label-swap'}>
          {busy ? <LoaderCircle size={17} className="spin" /> : step === 'reset' && <LockKeyhole size={17} />}
          {busy ? (step === 'recover' ? t('Checking…') : t('Saving…')) : step === 'recover' ? t('Continue') : t('Save password')}
        </span> : <span className={fadeLabel.current && step === 'unlock' && !busy ? 'label-swap label-fade' : 'label-swap label-still'}>
          {busy ? <LoaderCircle size={17} className="spin" /> : (step === 'password' || step === 'unlock') && <LockKeyhole size={17} />}
          {busy ? t('Opening vault…') : step === 'unlock' ? t('Unlock wallet') : step === 'password' ? t('Save wallet') : t('Continue')}
        </span>}
      </button>
      {step === 'unlock' && <button type="button" className="button text-button wide swap-below" disabled={busy || unlocked} onClick={() => swapTo('forgot')}>{t('Forgot password?')}</button>}
      {step !== 'unlock' && <button type="button" className={step === 'recover' ? 'button text-button wide swap-below' : 'button text-button wide'} disabled={busy} onClick={() => step === 'recover' ? swapTo('forgot') : step === 'reset' ? changeStep('recover') : changeStep(step === 'verify' ? 'create' : step === 'password' ? origin : 'choose')}><ArrowLeft size={16} /> {t('Back')}</button>}
    </form>}
  </Dialog>
}
