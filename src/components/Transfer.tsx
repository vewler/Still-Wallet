import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, Box, Check, Copy, ExternalLink, QrCode, ShieldAlert, Shuffle } from 'lucide-react'
import { addressFor, crossNetworks, explorerUrl, networks as mainnets, type Addresses, type Network, type NetworkId } from '../networks'
import type { Quote } from '../rpc'
import type { ActivityItem } from '../storage'
import { Coin, TokenIcon } from './Icons'
import { tokenById, tokens, type Token } from '../tokens'
import { afterTap, Dialog, ErrorSlot, Glide, Notice, Slot } from './Dialog'
import { Picker } from './Picker'

function NetworkField({ networks, selected, change }: { networks: Network[]; selected: Network; change: (network: Network) => void }) {
  return <div className="field"><span>Network</span>
    <Picker label="Network" value={selected.id} onChange={(id) => change(networks.find((network) => network.id === id)!)}
      options={networks.map((network) => ({ value: network.id, label: network.name, sub: `${network.label} · ${network.symbol}`, icon: <Coin chain={network.chain} /> }))} />
  </div>
}

function AssetField({ network, label, value, change }: { network: Network; label: string; value: string; change: (asset: string) => void }) {
  return <div className="field"><span>{label}</span>
    <Picker label={label} value={value} onChange={change} options={[
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

  return <Dialog title="Receive" close={close}>
    <div className="form">
      <NetworkField networks={networks} selected={selected} change={(network) => { setSelected(network); setAsset(network.id) }} />
      <Slot open={tokens.some((token) => token.network === selected.id)}><AssetField label="Asset" network={selected} value={asset} change={setAsset} /></Slot>
      <div className="qr-wrap">{qr?.address === address && qr.image ? <img src={qr.image} alt={`QR code for your ${selected.name} address`} width="196" height="196" /> : <span>{qr?.address === address ? 'QR code unavailable' : 'Preparing QR code…'}</span>}</div>
      <label className="field">Your {selected.name} address<input className="mono address-field" value={address} readOnly onFocus={(event) => event.target.select()} /></label>
      <Glide><p className="field-note">{selected.chain === 'xrp' ? 'Use the XRP Ledger. This wallet receives XRP without a destination tag. A new address needs the ledger’s current account reserve to activate.' : selected.chain === 'bitcoin' ? 'Send BTC on the Bitcoin network to this native SegWit (bc1) address.' : selected.chain === 'monero' ? 'Send XMR on the Monero network. Your view key scans new blocks on this device, incoming XMR shows after a refresh and unlocks after 10 blocks, about 20 minutes.' : `Use ${selected.name} ${selected.label} to receive ${tokenById(asset)?.symbol ?? selected.symbol}.`}</p></Glide>
      <button className="button primary wide" onClick={async () => {
        try {
          await navigator.clipboard.writeText(address)
          setCopyResult({ network: selected.id, copied: true })
        } catch {
          setCopyResult({ network: selected.id, copied: false })
        }
      }}><span key={String(!!result?.copied)} className="label-swap">{result?.copied ? <Check size={18} /> : <Copy size={18} />}{result?.copied ? 'Address copied' : 'Copy address'}</span></button>
      <ErrorSlot error={result && !result.copied ? 'Select and copy the address above.' : ''} />
    </div>
  </Dialog>
}

type TransactionActions = { close: () => void; submit: (review: Quote) => Promise<ActivityItem>; finished: () => void }

export function Send({ initial, initialAsset, networks, quote, ...actions }: TransactionActions & {
  initial?: Network; initialAsset?: string; networks: Network[]
  quote: (network: Network, to: string, amount: string, signal: AbortSignal, asset?: string, tag?: string) => Promise<Quote>
}) {
  const [selected, setSelected] = useState(initial ?? networks[0])
  const [asset, setAsset] = useState(initialAsset ?? selected.id)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [tag, setTag] = useState('')
  const token = tokenById(asset)
  return <TransactionDialog {...actions} title="Send" prepare={(signal) => quote(selected, recipient, amount, signal, token?.id, tag)}>
    <NetworkField networks={networks} selected={selected} change={(network) => { setSelected(network); setAsset(network.id); setTag('') }} />
    <Slot open={tokens.some((item) => item.network === selected.id)}><AssetField label="Asset" network={selected} value={asset} change={setAsset} /></Slot>
    <label className="field">{token && selected.chain === 'solana' ? 'Recipient wallet address' : 'Recipient address'}<input className="mono" name="recipient" placeholder={selected.chain === 'bitcoin' ? 'Bitcoin address' : selected.chain === 'xrp' ? 'XRP address' : selected.chain === 'monero' ? 'Monero address (4… or 8…)' : selected.chain === 'solana' ? 'Solana address' : '0x…'} value={recipient} onChange={(event) => setRecipient(event.target.value)} autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={100} required /></label>
    <Slot open={selected.chain === 'xrp'}><label className="field">Destination tag (if required)<input name="tag" inputMode="numeric" autoComplete="off" value={tag} onChange={(event) => setTag(event.target.value)} maxLength={10} /></label></Slot>
    <label className="field">Amount in {token?.symbol ?? selected.symbol}<input name="amount" inputMode="decimal" autoComplete="off" autoCorrect="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={36} required /></label>
  </TransactionDialog>
}

const swapAssets = crossNetworks.flatMap((id) => [id as string, ...tokens.filter((token) => token.network === id).map((token) => token.id)])

function SwapAssetField({ label, value, change }: { label: string; value: string; change: (asset: string) => void }) {
  return <div className="field"><span>{label}</span>
    <Picker label={label} value={value} onChange={change} options={swapAssets.map((id) => {
      const token = tokenById(id)
      const network = mainnets[(token?.network ?? id) as NetworkId]
      return { value: id, label: token?.symbol ?? network.symbol, sub: token ? `${token.name} · ${network.name}` : network.name, icon: token ? <TokenIcon token={token} /> : <Coin chain={network.chain} /> }
    })} />
  </div>
}

export function Swap({ quote, from, ...actions }: TransactionActions & {
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
  return <TransactionDialog {...actions} title="Swap" prepare={(signal) => quote(sell, buy, amount, signal, slippage)}>
    <SwapAssetField label="You pay" value={sell} change={(next) => { if (next === buy) setBuy(sell); setSell(next) }} />
    <SwapAssetField label="You receive" value={buy} change={(next) => { if (next === sell) setSell(buy); setBuy(next) }} />
    <label className="field">Amount in {tokenById(sell)?.symbol ?? mainnets[sell as NetworkId].symbol}<input name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={36} required /></label>
    <div className="field"><span>Max slippage</span>
      <Picker label="Max slippage" value={slippage} onChange={setSlippage} options={[0, 50, 100, 200, 300].map((value) => ({ value, label: value ? `${value / 100}%` : 'Auto', sub: !value ? 'Recommended, picked for each swap' : value < 100 ? 'May fail when prices move' : value > 100 ? 'Fills more often, can cost more' : 'Standard' }))} />
    </div>
    <Glide><p key={String(uniswap)} className="field-note">{uniswap ? 'Swaps on the same network use Uniswap v2. Liquidity varies by pair and amount.' : 'Swaps between networks use NEAR Intents. The new coins land in this wallet, usually within a few minutes.'}</p></Glide>
  </TransactionDialog>
}

/** Scramble, front end only for now: pick a token and amount and see the flow. Nothing is sent, no addresses are made
 *  and no network requests run; the button only says it isn't ready yet. */
export function Scramble({ networks, initial, initialAsset, close }: { networks: Network[]; initial?: Network; initialAsset?: string; close: () => void }) {
  const [network, setNetwork] = useState(initial ?? networks[0])
  const [asset, setAsset] = useState(initialAsset ?? network.id)
  const [amount, setAmount] = useState('')
  const [level, setLevel] = useState('balanced')
  const [tried, setTried] = useState(0)
  const symbol = tokenById(asset)?.symbol ?? network.symbol
  return <Dialog title="Scramble" close={close}>
    <form className="form" onSubmit={(event) => { event.preventDefault(); setTried((value) => value + 1) }}>
      <p className="dialog-intro">Move tokens to a brand-new wallet through a mix, so the new wallet can't be linked to this one.</p>
      <NetworkField networks={networks} selected={network} change={(next) => { setNetwork(next); setAsset(next.id) }} />
      <AssetField network={network} label="Token" value={asset} change={setAsset} />
      <label className="field">Amount in {symbol}<input name="amount" inputMode="decimal" autoComplete="off" autoCorrect="off" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={36} /></label>
      <div className="field"><span>Privacy</span>
        <Picker label="Privacy" value={level} onChange={setLevel} options={[
          { value: 'fast', label: 'Fast', sub: 'Fewer hops, done in minutes' },
          { value: 'balanced', label: 'Balanced', sub: 'Recommended' },
          { value: 'max', label: 'Maximum', sub: 'More hops spread over hours' },
        ]} />
      </div>
      <div className="field"><span>Goes to</span><div className="scramble-target">A new wallet, created on this device</div></div>
      <Slot open={tried > 0}><Notice key={tried}>Scramble is still being built. Nothing was sent.</Notice></Slot>
      <button className="button primary wide" type="submit">Scramble {symbol}</button>
    </form>
  </Dialog>
}

function TransactionDialog({ title, close, prepare, submit, finished, children }: TransactionActions & {
  title: 'Send' | 'Swap'; prepare: (signal: AbortSignal) => Promise<Quote>; children: ReactNode
}) {
  const [review, setReview] = useState<Quote>()
  const [item, setItem] = useState<ActivityItem>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function reviewTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const transfer = await prepare(controller.signal)
      if (!controller.signal.aborted) setReview(transfer)
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
    setError('')
    try { setItem(await submit(review)) }
    catch (problem) {
      setError(problem instanceof Error && !('details' in problem) && problem.message.length < 180 ? problem.message : 'Still could not sign this transaction. Refresh the quote and try again.')
    } finally { setBusy(false) }
  }

  if (item) return <Dialog title={item.status === 'submitted' ? 'Transaction submitted' : 'Submission unverified'} close={close}>
    <div className="form">
      <span className="empty-icon">{item.status === 'submitted' ? <Check size={25} /> : <ShieldAlert size={25} />}</span>
      <p className="dialog-intro">{item.status === 'submitted' ? item.kind === 'approval' ? 'Wait for confirmation, then review the swap again.' : 'The RPC accepted the transaction. Check Activity for confirmation.' : 'Submission is unverified. Check Activity before trying again.'}</p>
      <a className="text-link" href={explorerUrl(mainnets[item.network], 'tx', item.hash)} target="_blank" rel="noreferrer">Open transaction in explorer <ExternalLink size={15} /></a>
      {item.kind === 'approval' && <button className="button secondary wide" onClick={() => { setItem(undefined); edit() }}>Return to swap</button>}
      <button className="button primary wide" onClick={finished}>View activity <ArrowRight size={17} /></button>
    </div>
  </Dialog>

  const approval = review?.kind === 'approval'
  const swapping = review?.kind === 'swap'
  const symbol = review && (tokenById(review.asset ?? '')?.symbol ?? review.network.symbol)
  return <Dialog title={review ? approval ? 'Review token permission' : swapping ? 'Review swap' : 'Review transaction' : title} close={close} busy={busy}>
    {review ? <div className="form">
      <dl className="review-list">
        <div><dt>Network</dt><dd>{review.network.name} · {review.network.label}</dd></div>
        <div><dt>{review.via ?? (approval || swapping ? 'Uniswap v2 router' : 'Recipient')}</dt><dd className="mono">{review.to}</dd></div>
        {review.destinationTag !== undefined && <div><dt>Destination tag</dt><dd>{review.destinationTag}</dd></div>}
        <div><dt>{approval ? 'Spending limit' : swapping ? 'You pay' : 'Amount'}</dt><dd>{review.value} {symbol}</dd></div>
        {review.receive && <>
          <div><dt>Estimated receive</dt><dd>{review.receive.amount} {review.receive.symbol}{review.receive.network ? ` on ${review.receive.network}` : ''}</dd></div>
          <div><dt>Minimum receive ({review.receive.auto ? 'Auto ' : ''}{(review.receive.slippage ?? 100) / 100}% slippage)</dt><dd>{review.receive.minimum} {review.receive.symbol}</dd></div>
        </>}
        <div><dt>Network fee estimate</dt><dd>{review.fee} {review.network.symbol}</dd></div>
        {review.rent && <div><dt>Recipient token account rent</dt><dd>{review.rent} SOL</dd></div>}
        {review.eta !== undefined && <div><dt>Arrives in about</dt><dd>{review.eta < 90 ? '1 minute' : `${Math.round(review.eta / 60)} minutes`}</dd></div>}
      </dl>
      <Notice>{approval ? review.value === '0' ? 'This clears the router’s current allowance. Confirm it before granting a new one.' : 'This lets Uniswap spend the amount shown. The swap requires a separate confirmation.' : swapping ? review.via ? 'Your coins go to a one-time deposit address and the swapped coins come back to this wallet. If the swap can’t fill at the minimum, it refunds to this wallet.' : 'The swap returns assets to this wallet. If the price falls below the minimum or the quote expires on-chain, the swap can fail and still cost gas.' : 'This is a mainnet transfer. Check the full address and network. Broadcast transfers cannot be recalled.'}</Notice>
      {(review.receive?.impact ?? 0) >= .03 && <Notice error>Big price hit: you get about {Math.round(review.receive!.impact! * 100)}% less than the current price. Try a smaller amount.</Notice>}
      <ErrorSlot error={error} />
      <button className="button primary wide" onClick={() => void confirm()} disabled={busy}>{busy ? 'Submitting transaction…' : approval ? review.value === '0' ? 'Clear allowance' : 'Approve spending' : swapping ? 'Sign and swap' : 'Sign and send'}</button>
      <button className="button text-button wide" onClick={edit} disabled={busy}><ArrowLeft size={16} /> Edit {title === 'Swap' ? 'swap' : 'transfer'}</button>
    </div> : <form className="form" onSubmit={reviewTransfer}>
      <fieldset className="form" disabled={busy}>{children}</fieldset>
      <ErrorSlot error={error} />
      <button className="button primary wide" type="submit" disabled={busy}>{busy ? 'Getting quote…' : title === 'Swap' ? 'Review swap' : 'Review transaction'} <ArrowRight size={17} /></button>
    </form>}
  </Dialog>
}

export function AssetDetails({ network, token, amount, noWallet, close, send, receive, swap, scramble }: {
  network: Network; token?: Token; amount?: string; noWallet: boolean; close: () => void; send: (id: NetworkId) => void; receive: (id: NetworkId) => void; swap: () => void; scramble: () => void
}) {
  return <Dialog title={token ? `${token.symbol} on ${network.name}` : network.name} close={close}>
    <div className="asset-detail">
      {token ? <TokenIcon token={token} /> : <Coin chain={network.chain} />}
      <strong>{amount ?? `0 ${token?.symbol ?? network.symbol}`}</strong>
      <p>{token ? `${token.name} · ${network.name} ${network.label}` : `${network.name} ${network.label} · native ${network.symbol}`}</p>
    </div>
    <div className="actions actions--sheet">
      <button className="action" onClick={() => afterTap(() => receive(network.id))}><span><QrCode size={22} /></span>Receive</button>
      <button className="action" onClick={() => afterTap(() => send(network.id))}><span><ArrowUp size={22} /></span>Send</button>
      <button className="action" onClick={() => afterTap(swap)}><span><Shuffle size={22} /></span>Swap</button>
      {/* Placeholder: moves funds to a fresh wallet through a mixer later. For now it only opens a WIP sheet. */}
      <button className="action" onClick={() => afterTap(scramble)}><span><Box size={22} /></span>Scramble</button>
    </div>
    <p className="field-note center">{noWallet ? 'Set up a wallet to send and receive on this network.' : `Only use ${network.name} ${network.label} addresses with this asset.`}</p>
  </Dialog>
}
