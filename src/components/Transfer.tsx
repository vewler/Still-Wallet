import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Box, Check, Copy, ExternalLink, QrCode, ShieldAlert, Shuffle } from 'lucide-react'
import { addressFor, crossNetworks, explorerUrl, networks as mainnets, type Addresses, type Network, type NetworkId } from '../networks'
import type { Quote } from '../rpc'
import type { ActivityItem, Contact } from '../storage'
import { ContactAvatar, contactsFor, findContact, SaveContact, shortAddress, type EditContact } from './Contacts'
import { Coin, TokenIcon } from './Icons'
import { tokenById, tokens, unswappable, type Token } from '../tokens'
import { afterTap, Dialog, ErrorSlot, Glide, Notice, Slot } from './Dialog'
import { Picker } from './Picker'
import { priorityAssets, priorityNetworks } from '../assets'

/** Priority tokens as symbols (USDC), for the token list of one network. Its own coin always counts. */
const prioritySymbols = new Set(priorityAssets.flatMap((id) => tokenById(id)?.symbol ?? []))
import { t } from '../i18n'

function NetworkField({ networks, selected, change }: { networks: Network[]; selected: Network; change: (network: Network) => void }) {
  return <div className="field"><span>{t('Network')}</span>
    <Picker label={t('Network')} value={selected.id} onChange={(id) => change(networks.find((network) => network.id === id)!)}
      search={t('Search networks')} empty={t('No networks found')} priority={priorityNetworks} more={t('Search to find more networks')}
      options={networks.map((network) => ({ value: network.id, label: network.name, sub: `${network.label} · ${network.symbol}`, icon: <Coin chain={network.chain} /> }))} />
  </div>
}

function AssetField({ network, label, value, change }: { network: Network; label: string; value: string; change: (asset: string) => void }) {
  return <div className="field"><span>{t(label)}</span>
    <Picker label={t(label)} value={value} onChange={change} search={t('Search tokens')} empty={t('No tokens found')} more={t('Search to find more tokens')}
      priority={[network.id, ...tokens.filter((token) => token.network === network.id && prioritySymbols.has(token.symbol)).map((token) => token.id)]} options={[
      { value: network.id, label: network.symbol, sub: network.name, icon: <Coin chain={network.chain} /> },
      ...tokens.filter((token) => token.network === network.id).map((token) => ({ value: token.id, label: token.symbol, sub: token.name, icon: <TokenIcon token={token} /> })),
    ]} />
  </div>
}

export function Receive({ initial, initialAsset, networks, addresses, close }: { initial?: Network; initialAsset?: string; networks: Network[]; addresses: Addresses; close: () => void }) {
  const [selected, setSelected] = useState(initial ?? networks[0])
  const [asset, setAsset] = useState(initialAsset ?? selected.id)
  const [qr, setQr] = useState<{ address: string; image: string }>()
  const address = addressFor(selected, addresses)
  const [copyResult, setCopyResult] = useState<{ network: NetworkId; copied: boolean }>()
  const result = copyResult?.network === selected.id ? copyResult : undefined

  useEffect(() => {
    let current = true
    void import('qrcode').then(({ toDataURL }) => toDataURL(address, { width: 232, margin: 3, errorCorrectionLevel: 'M' }))
      .then((image) => { if (current) setQr({ address, image }) })
      .catch(() => { if (current) setQr({ address, image: '' }) })
    return () => { current = false }
  }, [address])

  return <Dialog title={t('Receive')} close={close}>
    <div className="form">
      <NetworkField networks={networks} selected={selected} change={(network) => { setSelected(network); setAsset(network.id) }} />
      <Slot open={tokens.some((token) => token.network === selected.id)}><AssetField label="Asset" network={selected} value={asset} change={setAsset} /></Slot>
      <div className="qr-wrap">{qr?.address === address && qr.image ? <img src={qr.image} alt={t('QR code for your {network} address', { network: selected.name })} width="196" height="196" /> : <span>{qr?.address === address ? t('QR code unavailable') : t('Preparing QR code…')}</span>}</div>
      <label className="field">{t('Your {network} address', { network: selected.name })}<input className="mono address-field" value={address} readOnly onFocus={(event) => event.target.select()} /></label>
      <Glide><p className="field-note">{selected.chain === 'xrp' ? t('Use the XRP Ledger. This wallet receives XRP without a destination tag. A new address needs the ledger’s current account reserve to activate.') : selected.chain === 'bitcoin' ? t('Send BTC on the Bitcoin network to this native SegWit (bc1) address.') : selected.chain === 'litecoin' ? t('Send LTC on the Litecoin network to this native SegWit (ltc1) address.') : selected.chain === 'dogecoin' ? t('Send DOGE on the Dogecoin network to this address.') : selected.chain === 'bitcoincash' ? t('Send BCH on the Bitcoin Cash network to this CashAddr address.') : selected.chain === 'dash' ? t('Send DASH on the Dash network to this address.') : selected.chain === 'zcash' ? t('Send ZEC to this transparent (t1) address. Shielded wallets can send here too, the coins arrive unshielded.') : selected.chain === 'kaspa' ? t('Send KAS on the Kaspa network to this address.') : selected.chain === 'tron' ? t('Use the Tron network (TRC-20 for tokens) to receive {symbol}. Sending tokens from Still needs some TRX for fees.', { symbol: tokenById(asset)?.symbol ?? 'TRX' }) : selected.chain === 'monero' ? t('Send XMR on the Monero network. Your view key scans new blocks on this device, incoming XMR shows after a refresh and unlocks after 10 blocks, about 20 minutes.') : t('Use {network} to receive {symbol}.', { network: `${selected.name} ${selected.label}`, symbol: tokenById(asset)?.symbol ?? selected.symbol })}</p></Glide>
      <button className="button primary wide" onClick={async () => {
        try {
          await navigator.clipboard.writeText(address)
          setCopyResult({ network: selected.id, copied: true })
        } catch {
          setCopyResult({ network: selected.id, copied: false })
        }
      }}><span key={String(!!result?.copied)} className="label-swap">{result?.copied ? <Check size={18} /> : <Copy size={18} />}{result?.copied ? t('Address copied') : t('Copy address')}</span></button>
      <ErrorSlot error={result && !result.copied ? t('Select and copy the address above.') : ''} />
    </div>
  </Dialog>
}

type TransactionActions = { close: () => void; submit: (review: Quote) => Promise<ActivityItem>; finished: () => void }
/** Send only: saved contacts to pick from, and save after sending. */
type Book = { contacts: Contact[]; editContact: EditContact }

export function Send({ initial, initialAsset, networks, quote, contacts, editContact, ...actions }: TransactionActions & Book & {
  initial?: Network; initialAsset?: string; networks: Network[]
  quote: (network: Network, to: string, amount: string, signal: AbortSignal, asset?: string, tag?: string) => Promise<Quote>
}) {
  const [selected, setSelected] = useState(initial ?? networks[0])
  const [asset, setAsset] = useState(initialAsset ?? selected.id)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [tag, setTag] = useState('')
  const token = tokenById(asset)
  const saved = contactsFor(contacts, selected).sort((a, b) => a.name.localeCompare(b.name))
  const picked = findContact(contacts, selected, recipient)
  return <TransactionDialog {...actions} title="Send" prepare={(signal) => quote(selected, recipient, amount, signal, token?.id, tag)}
    contactName={(to) => findContact(contacts, selected, to)?.name}
    after={(item) => !item.kind && item.status === 'submitted' ? <SaveContact network={selected} address={recipient} contacts={contacts} edit={editContact} /> : null}>
    <NetworkField networks={networks} selected={selected} change={(network) => { setSelected(network); setAsset(network.id); setTag('') }} />
    <Slot open={tokens.some((item) => item.network === selected.id)}><AssetField label="Asset" network={selected} value={asset} change={setAsset} /></Slot>
    <Slot open={saved.length > 0}><div className="field"><span>{t('Contact')}</span>
      <Picker label={t('Contact')} value={picked?.id ?? ''} onChange={(id) => { const contact = saved.find((item) => item.id === id); setRecipient(contact?.address ?? '') }} options={[
        { value: '', label: t('New address'), sub: t('Type or paste it below') },
        ...saved.map((contact) => ({ value: contact.id, label: contact.name, sub: `${shortAddress(contact.address)} · ${mainnets[contact.network].name}`, icon: <ContactAvatar contact={contact} /> })),
      ]} />
    </div></Slot>
    <label className="field">{token && selected.chain === 'solana' ? t('Recipient wallet address') : t('Recipient address')}<input className="mono" name="recipient" placeholder={selected.addressHint ?? (selected.chain === 'bitcoin' ? t('{network} address', { network: 'Bitcoin' }) : selected.chain === 'litecoin' ? t('{network} address', { network: 'Litecoin' }) : selected.chain === 'dogecoin' ? t('{network} address', { network: 'Dogecoin' }) + ' (D…)' : selected.chain === 'tron' ? t('{network} address', { network: 'Tron' }) + ' (T…)' : selected.chain === 'xrp' ? t('{network} address', { network: 'XRP' }) : selected.chain === 'monero' ? t('{network} address', { network: 'Monero' }) + ' (4…, 8…)' : selected.chain === 'solana' ? t('{network} address', { network: 'Solana' }) : selected.chain === 'sui' ? t('{network} address', { network: 'Sui' }) + ' (0x…)' : selected.chain === 'aptos' ? t('{network} address', { network: 'Aptos' }) + ' (0x…)' : '0x…')} value={recipient} onChange={(event) => setRecipient(event.target.value)} autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={100} required /></label>
    <Slot open={selected.chain === 'xrp'}><label className="field">{t('Destination tag (if required)')}<input name="tag" inputMode="numeric" autoComplete="off" value={tag} onChange={(event) => setTag(event.target.value)} maxLength={10} /></label></Slot>
    <Slot open={Boolean(selected.memo)}><label className="field">{t('Memo (if required)')}<input name="memo" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={tag} onChange={(event) => setTag(event.target.value)} maxLength={selected.chain === 'stellar' ? 28 : selected.chain === 'stacks' ? 34 : 200} /></label></Slot>
    <label className="field">{t('Amount in {symbol}', { symbol: token?.symbol ?? selected.symbol })}<input name="amount" inputMode="decimal" autoComplete="off" autoCorrect="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={36} required /></label>
  </TransactionDialog>
}

const swapAssets = crossNetworks.flatMap((id) => [id as string, ...tokens.filter((token) => token.network === id && !unswappable.has(token.id)).map((token) => token.id)])

function SwapAssetField({ label, value, change }: { label: string; value: string; change: (asset: string) => void }) {
  return <div className="field"><span>{t(label)}</span>
    <Picker label={t(label)} value={value} onChange={change} search={t('Search tokens')} empty={t('No tokens found')} priority={priorityAssets} more={t('Search to find more tokens')} options={swapAssets.map((id) => {
      const token = tokenById(id)
      const network = mainnets[(token?.network ?? id) as NetworkId]
      return { value: id, label: token?.symbol ?? network.symbol, sub: token ? `${token.name} · ${network.name}` : network.name, icon: token ? <TokenIcon token={token} /> : <Coin chain={network.chain} /> }
    })} />
  </div>
}

/** Switch the two coins: both boxes slide past each other into their new place while the arrow turns. */
function flipSwap(button: HTMLButtonElement, swap: () => void) {
  const pay = button.previousElementSibling?.querySelector<HTMLElement>('.picker-button')
  const receive = button.nextElementSibling?.querySelector<HTMLElement>('.picker-button')
  if (!pay || !receive) return swap()
  const distance = receive.getBoundingClientRect().top - pay.getBoundingClientRect().top
  flushSync(swap)
  const timing = { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' }
  const slide = (box: HTMLElement, from: number) => box.animate([
    { transform: `translateY(${from}px)`, opacity: 1 },
    { transform: `translateY(${from / 2}px) scale(.96)`, opacity: .55, offset: .5 },
    { transform: 'none', opacity: 1 },
  ], timing)
  slide(pay, distance)
  slide(receive, -distance)
  button.querySelector('svg')?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], timing)
}

export function Swap({ quote, from, customSlippage, ...actions }: TransactionActions & {
  /** Custom slippage from Settings, in basis points. Adds a Custom option when set. */
  customSlippage?: number
  quote: (sell: string, buy: string, amount: string, signal: AbortSignal, slippage: number) => Promise<Quote>
  /** From a coin sheet: preselect that coin if it can be swapped. */
  from?: { network: NetworkId; asset: string }
}) {
  const [sell, setSell] = useState<string>(from && swapAssets.includes(from.asset) ? from.asset : 'ethereum-main')
  const [buy, setBuy] = useState(() => {
    const network = tokenById(sell)?.network ?? sell
    return tokenById(sell)?.symbol === 'USDC' ? network : tokenById(`${network}:USDC`) ? `${network}:USDC` : 'ethereum-main:USDC'
  })
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(0)
  const sellNetwork = tokenById(sell)?.network ?? sell
  const buyNetwork = tokenById(buy)?.network ?? buy
  const uniswap = sellNetwork === buyNetwork && (sellNetwork === 'ethereum-main' || sellNetwork === 'base-main')
  return <TransactionDialog {...actions} title="Swap" prepare={(signal) => quote(sell, buy, amount, signal, slippage === -1 ? customSlippage ?? 0 : slippage)}>
    <SwapAssetField label="You pay" value={sell} change={(next) => { if (next === buy) setBuy(sell); setSell(next) }} />
    <button type="button" className="swap-flip" aria-label={t('Switch coins')} title={t('Switch coins')} onClick={(event) => flipSwap(event.currentTarget, () => { setSell(buy); setBuy(sell) })}><ArrowUpDown size={17} /></button>
    <SwapAssetField label="You receive" value={buy} change={(next) => { if (next === sell) setSell(buy); setBuy(next) }} />
    <label className="field">{t('Amount in {symbol}', { symbol: tokenById(sell)?.symbol ?? mainnets[sell as NetworkId].symbol })}<input name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={36} required /></label>
    <div className="field"><span>{t('Max slippage')}</span>
      <Picker label={t('Max slippage')} value={slippage} onChange={setSlippage} options={[...[0, 50, 100, 200, 300].map((value) => ({ value, label: value ? `${value / 100}%` : t('Auto'), sub: !value ? t('Recommended, picked for each swap') : value < 100 ? t('May fail when prices move') : value > 100 ? t('Fills more often, can cost more') : t('Standard') })),
        ...(customSlippage ? [{ value: -1, label: `${t('Custom')} ${customSlippage / 100}%`, sub: t('Set in Settings') }] : [])]} />
    </div>
    <Glide><p key={String(uniswap)} className="field-note">{uniswap ? t('Swaps on the same network use Uniswap v2. Liquidity varies by pair and amount.') : t('Swaps between networks use NEAR Intents. The new coins land in this wallet, usually within a few minutes.')}</p></Glide>
  </TransactionDialog>
}

/** Scramble, front end only for now: pick a token and amount and see the flow. Nothing is sent, no addresses are made
 *  and no network requests run; the button is disabled. */
export function Scramble({ networks, initial, initialAsset, close }: { networks: Network[]; initial?: Network; initialAsset?: string; close: () => void }) {
  const [network, setNetwork] = useState(initial ?? networks[0])
  const [asset, setAsset] = useState(initialAsset ?? network.id)
  const [amount, setAmount] = useState('')
  const [level, setLevel] = useState('balanced')
  const [target, setTarget] = useState('wallet')
  const [address, setAddress] = useState('')
  const symbol = tokenById(asset)?.symbol ?? network.symbol
  return <Dialog title={t('Scramble')} close={close}>
    <form className="form" onSubmit={(event) => event.preventDefault()}>
      <p className="dialog-intro">{t('Move tokens to a brand-new wallet through a mix, so the new wallet can’t be linked to this one.')}</p>
      <NetworkField networks={networks} selected={network} change={(next) => { setNetwork(next); setAsset(next.id) }} />
      <AssetField network={network} label="Token" value={asset} change={setAsset} />
      <label className="field">{t('Amount in {symbol}', { symbol })}<input name="amount" inputMode="decimal" autoComplete="off" autoCorrect="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={36} /></label>
      <div className="field"><span>{t('Privacy')}</span>
        <Picker label={t('Privacy')} value={level} onChange={setLevel} options={[
          { value: 'fast', label: t('Fast'), sub: t('Fewer hops, done in minutes') },
          { value: 'balanced', label: t('Balanced'), sub: t('Recommended') },
          { value: 'max', label: t('Maximum'), sub: t('More hops spread over hours') },
        ]} />
      </div>
      <div className="field"><span>{t('Goes to')}</span>
        <Picker label={t('Goes to')} value={target} onChange={setTarget} options={[
          { value: 'wallet', label: t('New wallet'), sub: t('Created on this device') },
          { value: 'address', label: t('Address'), sub: t('Type or paste it below') },
        ]} />
      </div>
      <Slot open={target === 'address'}><label className="field">{t('Recipient address')}<input className="mono" name="recipient" placeholder={network.addressHint ?? t('{network} address', { network: network.name })} value={address} onChange={(event) => setAddress(event.target.value)} autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={100} /></label></Slot>
      <button className="button unavailable wide" type="submit" disabled>{t('Unavailable')}</button>
    </form>
  </Dialog>
}

function TransactionDialog({ title, close, prepare, submit, finished, contactName, after, children }: TransactionActions & {
  title: 'Send' | 'Swap'; prepare: (signal: AbortSignal) => Promise<Quote>; children: ReactNode
  contactName?: (address: string) => string | undefined; after?: (item: ActivityItem) => ReactNode
}) {
  const [review, setReview] = useState<Quote>()
  const [item, setItem] = useState<ActivityItem>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function reviewTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const transfer = await prepare(controller.signal)
      if (!controller.signal.aborted) { setError(''); setReview(transfer) }
    } catch (problem) {
      if (!controller.signal.aborted) {
        const message = problem instanceof Error && !('details' in problem) && problem.message.length < 180 ? problem.message : 'The RPC could not prepare this transfer. Check your balance and network settings.'
        setError(message)
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function edit() {
    request.current?.abort()
    setReview(undefined)
    setError('')
  }

  async function confirm() {
    if (!review || busy) return
    setBusy(true)
    try { setItem(await submit(review)) }
    catch (problem) {
      setError(problem instanceof Error && !('details' in problem) && problem.message.length < 180 ? problem.message : 'Still could not sign this transaction. Refresh the quote and try again.')
    } finally { setBusy(false) }
  }

  if (item) return <Dialog title={item.status === 'submitted' ? t('Transaction submitted') : t('Submission unverified')} close={close}>
    <div className="form">
      <span className="empty-icon">{item.status === 'submitted' ? <Check size={25} /> : <ShieldAlert size={25} />}</span>
      <p className="dialog-intro">{item.status === 'submitted' ? item.kind === 'approval' ? t('Wait for confirmation, then review the swap again.') : t('The RPC accepted the transaction. Check Activity for confirmation.') : t('Submission is unverified. Check Activity before trying again.')}</p>
      <a className="text-link" href={explorerUrl(mainnets[item.network], 'tx', item.hash)} target="_blank" rel="noreferrer">{t('Open transaction in explorer')} <ExternalLink size={15} /></a>
      {after?.(item)}
      {item.kind === 'approval' && <button className="button secondary wide" onClick={() => { setItem(undefined); edit() }}>{t('Return to swap')}</button>}
      <button className="button primary wide" onClick={finished}>{t('View activity')} <ArrowRight size={17} /></button>
    </div>
  </Dialog>

  const approval = review?.kind === 'approval'
  const swapping = review?.kind === 'swap'
  const symbol = review && (tokenById(review.asset ?? '')?.symbol ?? review.network.symbol)
  return <Dialog title={review ? approval ? t('Review token permission') : swapping ? t('Review swap') : t('Review transaction') : t(title)} close={close} busy={busy}>
    {review ? <div className="form">
      <dl className="review-list">
        <div><dt>{t('Network')}</dt><dd>{review.network.name} · {review.network.label}</dd></div>
        <div><dt>{review.via ? t(review.via) : approval || swapping ? t('Uniswap v2 router') : t('Recipient')}</dt><dd className="mono">{!approval && !swapping && contactName?.(review.to) && <strong className="review-contact">{contactName(review.to)}</strong>}{review.to}</dd></div>
        {review.destinationTag !== undefined && <div><dt>{t('Destination tag')}</dt><dd>{review.destinationTag}</dd></div>}
        <div><dt>{approval ? t('Spending limit') : swapping ? t('You pay') : t('Amount')}</dt><dd>{review.value} {symbol}</dd></div>
        {review.receive && <>
          <div><dt>{t('Estimated receive')}</dt><dd>{review.receive.amount} {review.receive.symbol}{review.receive.network ? ` · ${review.receive.network}` : ''}</dd></div>
          <div><dt>{t('Minimum receive ({slippage} slippage)', { slippage: `${review.receive.auto ? t('Auto') + ' ' : ''}${(review.receive.slippage ?? 100) / 100}%` })}</dt><dd>{review.receive.minimum} {review.receive.symbol}</dd></div>
        </>}
        <div><dt>{t('Network fee estimate')}</dt><dd>{review.fee} {review.network.symbol}</dd></div>
        {review.rent && <div><dt>{t('Recipient token account rent')}</dt><dd>{review.rent} SOL</dd></div>}
        {review.eta !== undefined && <div><dt>{t('Arrives in about')}</dt><dd>{review.eta < 90 ? t('1 minute') : t('{count} minutes', { count: Math.round(review.eta / 60) })}</dd></div>}
      </dl>
      <Notice>{approval ? review.value === '0' ? t('This clears the router’s current allowance. Confirm it before granting a new one.') : t('This lets Uniswap spend the amount shown. The swap requires a separate confirmation.') : swapping ? review.via ? t('Your coins go to a one-time deposit address and the swapped coins come back to this wallet. If the swap can’t fill at the minimum, it refunds to this wallet.') : t('The swap returns assets to this wallet. If the price falls below the minimum or the quote expires on-chain, the swap can fail and still cost gas.') : t('This is a mainnet transfer. Check the full address and network. Broadcast transfers cannot be recalled.')}</Notice>
      {(review.receive?.impact ?? 0) >= .03 && <Notice error>{t('Big price hit: you get about {percent}% less than the current price. Try a smaller amount.', { percent: Math.round(review.receive!.impact! * 100) })}</Notice>}
      <ErrorSlot error={error} />
      <button className="button primary wide" onClick={() => void confirm()} disabled={busy}>{busy ? t('Submitting transaction…') : approval ? review.value === '0' ? t('Clear allowance') : t('Approve spending') : swapping ? t('Sign and swap') : t('Sign and send')}</button>
      <button className="button text-button wide" onClick={edit} disabled={busy}><ArrowLeft size={16} /> {title === 'Swap' ? t('Edit swap') : t('Edit transfer')}</button>
    </div> : <form className="form" onSubmit={reviewTransfer}>
      <fieldset className="form" disabled={busy}>{children}</fieldset>
      <ErrorSlot error={error} />
      <button className="button primary wide" type="submit" disabled={busy}>{busy ? t('Getting quote…') : title === 'Swap' ? t('Review swap') : t('Review transaction')} <ArrowRight size={17} /></button>
    </form>}
  </Dialog>
}

export function AssetDetails({ network, token, amount, noWallet, close, send, receive, swap, scramble }: {
  network: Network; token?: Token; amount?: string; noWallet: boolean; close: () => void; send: (id: NetworkId) => void; receive: (id: NetworkId) => void; swap: () => void; scramble: () => void
}) {
  return <Dialog title={token ? t('{symbol} on {network}', { symbol: token.symbol, network: network.name }) : network.name} close={close} className="dialog--asset">
    <div className="asset-detail">
      {token ? <TokenIcon token={token} /> : <Coin chain={network.chain} />}
      <strong>{amount ?? `0 ${token?.symbol ?? network.symbol}`}</strong>
      <p>{token ? `${token.name} · ${network.name} ${network.label}` : `${network.name} ${network.label} · ${t('native {symbol}', { symbol: network.symbol })}`}</p>
    </div>
    <div className="actions actions--sheet">
      <button className="action" onClick={() => afterTap(() => receive(network.id))}><span><QrCode size={22} /></span>{t('Receive')}</button>
      <button className="action" onClick={() => afterTap(() => send(network.id))}><span><ArrowUp size={22} /></span>{t('Send')}</button>
      <button className="action" onClick={() => afterTap(swap)}><span><Shuffle size={22} /></span>{t('Swap')}</button>
      {/* Placeholder: moves funds to a fresh wallet through a mixer later. For now it only opens a WIP sheet. */}
      <button className="action" onClick={() => afterTap(scramble)}><span><Box size={22} /></span>{t('Scramble')}</button>
    </div>
    <p className="field-note center">{noWallet ? t('Set up a wallet to send and receive on this network.') : t('Only use {network} addresses with this asset.', { network: `${network.name} ${network.label}` })}</p>
  </Dialog>
}
