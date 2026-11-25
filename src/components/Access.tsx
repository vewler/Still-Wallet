import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, LoaderCircle, LockKeyhole, Wallet, X } from 'lucide-react'
import type { Session } from '../vault'
import { passwordRules } from '../passwords'

// Crypto code is lazy loaded (prewarmed after first paint) to keep it out of the main bundle.
const vault = () => import('../vault')
import { Dialog, ErrorSlot, PasswordInput } from './Dialog'
import { t } from '../i18n'

type AccessStep = 'choose' | 'create' | 'verify' | 'import' | 'password' | 'unlock' | 'done'
const order: AccessStep[] = ['choose', 'create', 'import', 'verify', 'password', 'unlock', 'done']

export function Access({ locked, intent, close, onSession }: {
  locked: boolean; intent?: 'send' | 'receive' | 'swap'; close: () => void; onSession: (session: Session) => void
}) {
  const [step, setStep] = useState<AccessStep>(locked ? 'unlock' : 'choose')
  const [phrase, setPhrase] = useState('')
  const [answer, setAnswer] = useState('')
  const [wordIndex] = useState(() => Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * 12))
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [origin, setOrigin] = useState<'verify' | 'import'>('verify')
  const [back, setBack] = useState(false)

  const changeStep = (next: AccessStep) => {
    setError('')
    setPassword('')
    setConfirmation('')
    setBack(order.indexOf(next) < order.indexOf(step))
    setStep(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Errors stay until replaced, so a repeat shakes instead of reopening.
    const fail = (message: string) => { setError(message); setTries((value) => value + 1) }
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
      if (step === 'unlock') { setUnlocked(true); setTimeout(() => onSession(session), 650); return }
      // Short success beat before the wallet opens.
      setBack(false)
      setStep('done')
      setTimeout(() => onSession(session), 900)
    } catch (problem) {
      fail(problem instanceof Error ? problem.message : 'The local wallet could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<AccessStep, string> = {
    choose: t('Set up Still'), create: t('Back up your recovery phrase'), verify: t('Check your backup'),
    import: t('Import a wallet'), password: t('Set a password'), unlock: t('Unlock Still'), done: t('Wallet ready'),
  }

  return <Dialog title={titles[step]} close={close} busy={busy || unlocked || step === 'done'} back={back}>
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
    {step !== 'choose' && step !== 'create' && step !== 'done' && <form className="form" autoComplete="off" onSubmit={submit}>
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
        {step === 'password' && <ul className="password-rules" id="password-rules" aria-live="polite">
          {passwordRules.map((rule) => { const met = rule.test(password); return <li key={rule.label} className={met ? 'met' : ''}>{met ? <Check size={14} /> : <X size={14} />}{t(rule.label)}</li> })}
        </ul>}
        {step === 'password' && <label className="field">{t('Confirm pass⁠word')}<PasswordInput value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={256} /></label>}
      </>}
      <ErrorSlot error={error} attempt={tries} />
      <button type="submit" className="button primary wide" disabled={busy || unlocked}>
        {unlocked ? <span key="open" className="label-swap"><LockKeyhole size={17} className="unlocking" />{t('Unlocked')}</span> : <>
          {busy ? <LoaderCircle size={17} className="spin" /> : (step === 'password' || step === 'unlock') && <LockKeyhole size={17} />}
          {busy ? t('Opening vault…') : step === 'unlock' ? t('Unlock wallet') : step === 'password' ? t('Save wallet') : t('Continue')}
        </>}
      </button>
      {step !== 'unlock' && <button type="button" className="button text-button wide" disabled={busy} onClick={() => changeStep(step === 'verify' ? 'create' : step === 'password' ? origin : 'choose')}><ArrowLeft size={16} /> {t('Back')}</button>}
    </form>}
  </Dialog>
}
