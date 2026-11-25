import { useRef, type CSSProperties } from 'react'
import { ArrowUp, Box, QrCode, ShieldCheck, Shuffle, SlidersHorizontal } from 'lucide-react'
import { activeNetworks, formatAmount, type Network, type NetworkId } from '../networks'
import type { Prices } from '../rpc'
import { type Preferences } from '../storage'
import { RefreshIcon } from './Spinner'
import { afterTap } from './Dialog'
import { Coin, TokenIcon } from './Icons'
import type { Token } from '../tokens'
import { arrangeAssets, type Asset, type AssetLayout } from '../assets'
import { Rolling, useRolling } from './Charts'
import { t } from '../i18n'

export type Balance = { amount?: bigint; unavailable?: boolean }
type Props = {
  mode: 'none' | 'locked' | 'wallet'
  preferences: Preferences
  balances: Partial<Record<NetworkId, Balance>>
  refreshing: boolean
  /** Refresh came from a pull: gray out the button, no spin. */
  pulled: boolean
  refresh: () => void
  prices: Prices
  /** 24-hour change in percent per coin id. */
  changes: Prices
  swap: () => void
  scramble: () => void
  openTransfer: (action: 'send' | 'receive', network?: Network) => void
  openAsset: (network: Network) => void
  tokenBalances: Record<string, Balance>
  openToken: (token: Token) => void
  layout: AssetLayout
  manage: () => void
}

export function Overview({ mode, preferences, balances, refreshing, pulled, refresh, prices, changes, swap, scramble, openTransfer, openAsset, tokenBalances, openToken, layout, manage }: Props) {
  const hidden = preferences.hide
  // Only animate amounts after the eye toggle, not on first load.
  const startHidden = useRef(hidden)
  const toggled = useRef(false)
  if (hidden !== startHidden.current) toggled.current = true
  const networks = activeNetworks(preferences.environment)
  const canRefresh = !refreshing && mode === 'wallet' && !preferences.offline
  const shown = arrangeAssets(preferences.environment, layout).filter((entry) => entry.shown).map((entry) => entry.asset)
  // Side panel: only the networks of the coins shown on Home, in the same order.
  const sideNetworks = networks.filter((network) => shown.some((asset) => asset.network === network.id))
    .sort((a, b) => shown.findIndex((asset) => asset.network === a.id) - shown.findIndex((asset) => asset.network === b.id))
  const balanceOf = (asset: Asset) => asset.token ? tokenBalances[asset.id] : balances[asset.network]
  const fiat = (asset: Asset) => {
    const amount = balanceOf(asset)?.amount ?? 0n
    if (amount === 0n) return 0
    const price = prices[asset.priceId]
    return price === undefined ? undefined : Number(formatAmount(amount, asset.decimals)) * price
  }
  const values = shown.map(fiat)
  const total = values.every((value) => value !== undefined) ? values.reduce<number>((sum, value) => sum + value!, 0) : undefined
  // Yesterday's total = each value before its 24h change.
  const yesterday = total === undefined || shown.some((asset, index) => values[index] && changes[asset.priceId] === undefined) ? undefined
    : shown.reduce((sum, asset, index) => sum + (values[index] ? values[index]! / (1 + changes[asset.priceId]! / 100) : 0), 0)
  const dayChange = total !== undefined && yesterday !== undefined ? total - yesterday : undefined
  const dayPercent = dayChange !== undefined && yesterday ? dayChange / yesterday * 100 : 0

  return <div className={toggled.current ? 'home home--mask-anim' : 'home'}>
    <div className="summary">
    <section className="hero" aria-label={t('Portfolio balance')}>
      <div className="hero-amount"><span key={String(hidden)} className="mask-swap mask-swap--hero">{hidden ? <span className="redacted">••••••</span> : total === undefined ? <span className="hero-amount--empty">{t('Prices unavailable')}</span> : <BalanceAmount value={total} currency={preferences.currency} />}</span></div>
      <div key={String(hidden)} className="hero-change mask-row">{mode === 'wallet' && !preferences.offline && dayChange !== undefined
        ? hidden ? <span>{t('Balances hidden')}</span> : <><span className={dayChange < 0 ? 'down' : 'up'}>{dayChange < 0 ? '−' : '+'}{formatFiat(Math.abs(dayChange), preferences.currency)}</span><span className={dayChange < 0 ? 'pill-down' : 'pill-up'}>{percentText(dayPercent)}</span><span>{t('today')}</span></>
        : <span>{mode === 'none' ? t('Set up a wallet to get started') : preferences.offline ? t('Network requests paused') : t('Total balance')}</span>}</div>
    </section>

    <div className="actions" role="group" aria-label={t('Wallet actions')}>
      <button className="action" onClick={() => afterTap(() => openTransfer('receive'))}><span><QrCode size={22} /></span>{t('Receive')}</button>
      <button className="action" onClick={() => afterTap(() => openTransfer('send'))}><span><ArrowUp size={22} /></span>{t('Send')}</button>
      <button className="action" onClick={() => afterTap(swap)}><span><Shuffle size={22} /></span>{t('Swap')}</button>
      <button className="action action--desktop" onClick={() => afterTap(scramble)}><span><Box size={22} /></span>{t('Scramble')}</button>
      <button className={pulled ? 'action action--pulled' : 'action'} onClick={refresh} disabled={!canRefresh}><span><RefreshIcon size={21} spinning={refreshing && !pulled} /></span>{t('Refresh')}</button>
    </div>
    </div>

    <aside className="home-side">
      {/* Desktop only: networks + privacy note */}
      <div className="side-card">
        <div className="side-card-head"><h2>{t('Networks')}</h2>{mode === 'wallet' ? <button type="button" className="text-link" onClick={manage}>{t('Manage')}</button> : <a href="#networks" className="text-link">{t('Manage')}</a>}</div>
        {sideNetworks.map((network) => <a key={network.id} href="#networks" className="side-network">
          <Coin chain={network.chain} /><span><strong>{network.name}</strong><small>{network.label}</small></span>
          <i className="dot dot--main" />
        </a>)}
      </div>
    </aside>

    <section className="tokens" aria-labelledby="tokens-heading">
      <div className="list-head"><h2 id="tokens-heading" className="list-title">{t('Tokens')}</h2>{mode === 'wallet' && <button type="button" className="round-button small" onClick={manage} aria-label={t('Manage tokens')}><SlidersHorizontal size={16} /></button>}</div>
      <div className="token-list">
        {shown.map((asset, index) => {
          const network = networks.find((entry) => entry.id === asset.network)!
          const state = balanceOf(asset)
          const quantity = `${displayTotal(state?.amount ?? 0n, asset.decimals)} ${asset.symbol}`
          const value = values[index]
          const where = asset.token ? network.name : network.label
          const notice = state?.unavailable ? t('RPC unavailable') : preferences.offline && mode === 'wallet' ? t('Requests paused') : asset.chain === 'monero' && !state && mode === 'wallet' ? t('Scanning blocks…') : undefined
          return <button key={asset.id} className="token" onClick={() => asset.token ? openToken(asset.token) : openAsset(network)}>
            {asset.token ? <TokenIcon token={asset.token} /> : <Coin chain={asset.chain} />}
            <span className="token-name"><strong>{asset.token ? asset.symbol : asset.name}</strong><small>{notice && !hidden ? notice : <>{where} · <span key={String(hidden)} className="mask-swap" style={{ animationDelay: `${index * 12}ms` }}>{hidden ? '••••' : quantity}</span></>}</small></span>
            <span className="token-value">
              <strong><span key={String(hidden)} className="mask-swap" style={{ animationDelay: `${index * 12}ms` }}>{hidden ? '••••' : value === undefined ? quantity : <Rolling value={value} ms={600} format={(amount) => formatFiat(amount, preferences.currency)} />}</span></strong>
              {changes[asset.priceId] !== undefined && !preferences.offline && <small className={changes[asset.priceId]! < 0 ? 'down' : 'up'}>{percentText(changes[asset.priceId]!)}</small>}
            </span>
          </button>
        })}
      </div>
    </section>

    <p className="trust-note"><ShieldCheck size={17} /><span>{t('Self-custody · keys never leave this device')}</span></p>
  </div>
}

function displayTotal(amount: bigint, decimals: number) {
  const [whole, fraction = ''] = formatAmount(amount, decimals).split('.')
  if (whole === '0' && amount > 0n && /^0{6}/.test(fraction)) return '<0.000001'
  const visible = fraction.slice(0, 6).replace(/0+$/, '')
  return BigInt(whole).toLocaleString('en-US') + (visible ? `.${visible}` : '')
}

/** 1-day change, e.g. +2.41% or −0.38% (real minus sign). */
function percentText(value: number) {
  return `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}%`
}

function formatFiat(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(value)
}

function BalanceAmount({ value, currency }: { value: number; currency: string }) {
  // Totals roll on refresh, pop-in only the first time.
  const text = formatFiat(useRolling(value, 600), currency)
  const dot = text.lastIndexOf('.')
  const whole = dot < 0 ? text : text.slice(0, dot)
  return <span className="balance-amount rolling" style={{ '--chars': text.length } as CSSProperties}>{whole}{dot >= 0 && <span>{text.slice(dot)}</span>}</span>
}
