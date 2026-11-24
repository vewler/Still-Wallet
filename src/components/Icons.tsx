import { useId } from 'react'
import type { Chain } from '../networks'

export function Brand({ name = 'Still', stacked = false }: { name?: string; stacked?: boolean }) {
  return <span className={stacked ? 'brand brand--stacked' : 'brand'}><img src="/icons/brand.svg" alt="" width="29" height="29" /><strong>{name}</strong></span>
}

// viewBoxes are offset to center each glyph (some logos aren't centered).
export function Coin({ chain }: { chain: Chain }) {
  const id = useId()
  return <span className={`coin coin--${chain}`} aria-hidden="true">
    {chain === 'ethereum' && <svg viewBox="0 0 32 32" fill="none">
      <path fill="#fff" d="M16 2 6.6 16 16 12z" />
      <path fill="#adbdff" d="M16 2v10l9.4 4z" />
      <path fill="#d8e1ff" d="m6.6 16 9.4 5.8V12z" />
      <path fill="#7f96ff" d="M16 12v9.8l9.4-5.8z" />
      <path fill="#fff" d="M16 24.2 6.6 18.5 16 30z" />
      <path fill="#b5c6ff" d="M16 24.2V30l9.4-11.5z" />
    </svg>}
    {chain === 'solana' && <svg viewBox="0.5 0 32 32">
      <defs><linearGradient id={id} x1="27" y1="6" x2="6" y2="27" gradientUnits="userSpaceOnUse"><stop stopColor="#15fbb0" /><stop offset="1" stopColor="#ad53ff" /></linearGradient></defs>
      <path fill={`url(#${id})`} d="M8.3 6.8h20.2a.5.5 0 0 1 .3.8l-4.1 4H4.5a.5.5 0 0 1-.3-.8zm-3.8 6.8h20.2l4.1 4a.5.5 0 0 1-.3.8H8.3l-4.1-4a.5.5 0 0 1 .3-.8zm3.8 6.8h20.2a.5.5 0 0 1 .3.8l-4.1 4H4.5a.5.5 0 0 1-.3-.8z" />
    </svg>}
    {chain === 'base' && <svg viewBox="0.16 0 32 32"><path fill="#fff" d="M16.1 4a12 12 0 1 1-11.9 13.4h14.4V14.6H4.2A12 12 0 0 1 16.1 4Z" /></svg>}
    {chain === 'bitcoin' && <svg viewBox="-2.95 0.6 32 32"><path fill="#fff" d="M21.6 14.3c.4-2.4-1.5-3.7-4-4.6l.8-3.3-2-.5-.8 3.2-1.6-.4.8-3.2-2-.5-.8 3.3-1.3-.3-2.8-.7-.5 2.1s1.5.3 1.5.4c.8.2 1 .7.9 1.2l-2.2 9c-.1.3-.4.6-.9.5 0 0-1.5-.4-1.5-.4l-1 2.3 2.7.7 1.5.4-.8 3.3 2 .5.8-3.3 1.6.4-.8 3.3 2 .5.8-3.4c3.5.7 6.1.4 7.2-2.8.9-2.5 0-4-1.9-5 1.3-.3 2.4-1.2 2.6-3zm-4.6 6.5c-.6 2.5-4.9 1.2-6.3.8l1.1-4.5c1.4.4 5.9 1 5.2 3.7zm.6-6.5c-.6 2.3-4.1 1.1-5.3.8l1-4c1.2.3 4.9.9 4.3 3.2z" /></svg>}
    {chain === 'xrp' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M6.5 8h3.2l4.4 4.4a2.7 2.7 0 0 0 3.8 0L22.3 8h3.2l-5.8 5.8a5.3 5.3 0 0 1-7.4 0ZM6.5 24h3.2l4.4-4.4a2.7 2.7 0 0 1 3.8 0l4.4 4.4h3.2l-5.8-5.8a5.3 5.3 0 0 0-7.4 0Z" /></svg>}
    {chain === 'bnb' && <svg viewBox="0 0 32 32" fill="#fff">{[[16, 16, 4.2], [16, 7.6, 3], [16, 24.4, 3], [7.6, 16, 3], [24.4, 16, 3]].map(([x, y, r]) => <path key={`${x}${y}`} d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`} />)}</svg>}
    {chain === 'monero' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M6 22V9.5l10 10 10-10V22h-3.4v-4.4L16 24.2l-6.6-6.6V22Z" /></svg>}
    {chain === 'hyperevm' && <svg viewBox="0 0 32 32"><path fill="#0b2e2a" d="M5 16c0-5 2.6-8.5 6.4-8.5 3.4 0 4.5 2.6 4.6 4.5.1-1.9 1.2-4.5 4.6-4.5 3.8 0 6.4 3.5 6.4 8.5s-2.6 8.5-6.4 8.5c-3.4 0-4.5-2.6-4.6-4.5-.1 1.9-1.2 4.5-4.6 4.5C7.6 24.5 5 21 5 16Z" /></svg>}
  </span>
}

/** Token badge: symbol on brand color, chain coin in the corner. */
export function TokenIcon({ token }: { token: { chain: Chain; symbol: string; color: string } }) {
  return <span className="token-icon" aria-hidden="true">
    <span className="coin coin--token" style={{ background: token.color }}><b data-len={Math.min(token.symbol.length, 4)}>{token.symbol.slice(0, 4)}</b></span>
    <span className="token-chain"><Coin chain={token.chain} /></span>
  </span>
}
