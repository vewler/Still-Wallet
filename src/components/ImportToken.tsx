import { useEffect, useRef, useState, type FormEvent } from 'react'
import { activeNetworks, importNetworks, networks, type Environment, type NetworkId } from '../networks'
import { knownToken, tokenColor, type UserToken } from '../tokens'
import { ErrorSlot, Notice } from './Dialog'
import { Coin, TokenIcon } from './Icons'
import { Picker } from './Picker'
import { t } from '../i18n'

/** Paste a contract or mint address, check what it is, then add it. */
export function ImportToken({ environment, lookup, add, cancel }: {
  environment: Environment
  lookup: (network: NetworkId, address: string, signal: AbortSignal) => Promise<UserToken>
  add: (token: UserToken) => void
  cancel: () => void
}) {
  const list = activeNetworks(environment).filter((network) => importNetworks.includes(network.id))
  const [network, setNetwork] = useState<NetworkId>(list[0].id)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [found, setFound] = useState<UserToken>()
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const selected = networks[network]

  async function search(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const text = address.trim()
    setError('')
    if (!text) { setError('Paste the token’s contract address.'); setAttempt((value) => value + 1); return }
    const listed = knownToken(network, text)
    if (listed) { setError(t('{symbol} is already in your list. Add it from Manage tokens.', { symbol: listed.symbol })); setAttempt((value) => value + 1); return }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const token = await lookup(network, text, controller.signal)
      if (!controller.signal.aborted) setFound(token)
    } catch (problem) {
      if (!controller.signal.aborted) { setError(problem instanceof Error ? problem.message : 'Still could not read this token.'); setAttempt((value) => value + 1) }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  if (found) {
    return <div className="form">
      <div className="import-preview">
        <TokenIcon token={{ chain: selected.chain, symbol: found.symbol, color: tokenColor(found.contract) }} />
        <span className="row-text"><strong>{found.symbol}</strong><small>{found.name} · {selected.name}</small></span>
      </div>
      <p className="import-contract">{found.contract}</p>
      {found.verified
        ? <Notice>{t('CoinGecko lists this token. Still, only import addresses from a source you trust.')}</Notice>
        : <Notice error>{t('Unverified token. Anyone can create a token with any name, and scams often copy real ones. Only import it if you trust where the address came from.')}</Notice>}
      {found.verified
        ? <div className="two-actions"><button type="button" className="button secondary" onClick={() => setFound(undefined)}>{t('Back')}</button><button type="button" className="button primary" onClick={() => add(found)}>{t('Import')}</button></div>
        : <div className="two-actions"><button type="button" className="button primary" onClick={() => setFound(undefined)}>{t('Back')}</button><button type="button" className="button secondary" onClick={() => add(found)}>{t('Import anyway')}</button></div>}
    </div>
  }

  return <form className="form" onSubmit={(event) => void search(event)} autoComplete="off">
    <p className="dialog-intro">{t('Add a token Still doesn’t list. Paste its contract address (mint address on Solana).')}</p>
    <div className="field"><span>{t('Network')}</span>
      <Picker label={t('Network')} value={network} onChange={(id) => { setNetwork(id); setError('') }}
        options={list.map((entry) => ({ value: entry.id, label: entry.name, sub: entry.label, icon: <Coin chain={entry.chain} /> }))} />
    </div>
    <label className="field">{selected.chain === 'solana' ? t('Mint address') : t('Contract address')}
      <input name="token-address" value={address} onChange={(event) => { setAddress(event.target.value); setError('') }} placeholder={selected.chain === 'solana' ? t('Mint address') : selected.chain === 'tron' ? 'T…' : '0x…'}
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={64} data-1p-ignore data-lpignore="true" />
    </label>
    <ErrorSlot error={error} attempt={attempt} />
    <div className="two-actions">
      <button type="button" className="button secondary" onClick={cancel} disabled={busy}>{t('Cancel')}</button>
      <button type="submit" className="button primary" disabled={busy}><span key={String(busy)} className="label-swap">{busy ? t('Checking…') : t('Find token')}</span></button>
    </div>
  </form>
}
