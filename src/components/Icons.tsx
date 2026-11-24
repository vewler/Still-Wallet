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
    {chain === 'dogecoin' && <svg viewBox="0 0 32 32" fill="#fff"><path fillRule="evenodd" d="M9.5 8h7.1c5 0 8.4 3.2 8.4 8s-3.4 8-8.4 8H9.5v-6.6H7.4v-2.8h2.1Zm3.4 3v4.6h4.6v2.8h-4.6V21h3.6c3.1 0 5.1-2 5.1-5s-2-5-5.1-5Z" /></svg>}
    {chain === 'bitcoincash' && <svg viewBox="-2.95 0.6 32 32"><g transform="rotate(-28 13 16.6)"><path fill="#fff" d="M21.6 14.3c.4-2.4-1.5-3.7-4-4.6l.8-3.3-2-.5-.8 3.2-1.6-.4.8-3.2-2-.5-.8 3.3-1.3-.3-2.8-.7-.5 2.1s1.5.3 1.5.4c.8.2 1 .7.9 1.2l-2.2 9c-.1.3-.4.6-.9.5 0 0-1.5-.4-1.5-.4l-1 2.3 2.7.7 1.5.4-.8 3.3 2 .5.8-3.3 1.6.4-.8 3.3 2 .5.8-3.4c3.5.7 6.1.4 7.2-2.8.9-2.5 0-4-1.9-5 1.3-.3 2.4-1.2 2.6-3zm-4.6 6.5c-.6 2.5-4.9 1.2-6.3.8l1.1-4.5c1.4.4 5.9 1 5.2 3.7zm.6-6.5c-.6 2.3-4.1 1.1-5.3.8l1-4c1.2.3 4.9.9 4.3 3.2z" /></g></svg>}
    {chain === 'dash' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M12.4 8.5h10.2c2.6 0 3.9 1.6 3.3 4.1l-1.8 7.3c-.6 2.4-2.6 3.6-5.2 3.6H6.5l.8-3h10.9c.9 0 1.5-.4 1.7-1.3l1.7-6.6c.2-.8-.2-1.2-1-1.2H11.6Zm-4.9 6.1h7.4l-.7 2.8H6.8Z" /></svg>}
    {chain === 'zcash' && <svg viewBox="0 0 32 32" fill="#231f20"><path d="M14.6 5h2.8v3.3h5v3.3l-7.3 9.9h7.3V24h-5v3h-2.8v-3h-5.1v-3.1l7.3-9.9h-7.3V8.3h5.1Z" /></svg>}
    {chain === 'kaspa' && <svg viewBox="0 0 32 32" fill="#0b3b33"><path d="M10 6.5h3.2v7.3l7.7-7.3h4.3l-8.6 8.1 9 10.9h-4.2l-7.2-8.8-1 1v7.8H10Z" /></svg>}
    {chain === 'litecoin' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M13.6 6.5h4.1l-2.4 9.3 3.1-1.2-.7 2.6-3.1 1.2-1.4 5.3h10.3l-.8 2.8H8.4l2-7.7-2.6 1 .7-2.6 2.6-1Z" /></svg>}
    {chain === 'tron' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"><path d="M6.5 7.5 26 11.2 15.4 25.5ZM6.5 7.5l8.9 18M26 11.2l-9.6 3.4-9.9-7.1M16.4 14.6l-1 10.9" /></svg>}
    {chain === 'avalanche' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M14.4 7.6c.7-1.2 1.9-1.2 2.6 0l1.7 3c.4.7.4 1.6 0 2.3l-6.2 10.7c-.4.7-1.2 1.2-2 1.2H7c-1.2 0-1.8-1.1-1.2-2.1Zm6.2 9.6c.6-1 1.6-1 2.2 0l3.4 5.9c.6 1-.1 2.1-1.2 2.1h-6.8c-1.1 0-1.8-1.1-1.2-2.1Z" /></svg>}
    {chain === 'polygon' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M21.2 12.6a1.5 1.5 0 0 0-1.4 0l-3.3 1.9-2.2 1.3-3.3 1.9a1.5 1.5 0 0 1-1.4 0L7 16.2a1.4 1.4 0 0 1-.7-1.2v-2.9c0-.5.2-.9.7-1.2l2.6-1.5a1.5 1.5 0 0 1 1.4 0l2.6 1.5c.4.3.7.7.7 1.2V14l2.2-1.3v-2a1.4 1.4 0 0 0-.7-1.2l-4.8-2.8a1.5 1.5 0 0 0-1.4 0L4.7 9.5a1.4 1.4 0 0 0-.7 1.2v5.6c0 .5.3.9.7 1.2l4.9 2.8c.4.2 1 .2 1.4 0l3.3-1.9 2.2-1.3 3.3-1.9a1.5 1.5 0 0 1 1.4 0l2.6 1.5c.4.3.7.7.7 1.2v2.9c0 .5-.3.9-.7 1.2l-2.6 1.5a1.5 1.5 0 0 1-1.4 0l-2.6-1.5a1.4 1.4 0 0 1-.7-1.2V18l-2.2 1.3v2c0 .5.3.9.7 1.2l4.9 2.8c.4.2 1 .2 1.4 0l4.9-2.8c.4-.3.7-.7.7-1.2v-5.6c0-.5-.3-.9-.7-1.2Z" /></svg>}
    {chain === 'arbitrum' && <svg viewBox="0 0 32 32" fill="none"><path fill="#fff" d="M16 4.5 26 10.3v11.4L16 27.5 6 21.7V10.3Z" opacity=".14" /><path stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" d="M16 4.5 26 10.3v11.4L16 27.5 6 21.7V10.3Z" /><path fill="#12aaff" d="m17.4 12.6 1.5-2.5 5.5 9.4-1.4 2.4ZM14.9 17.7l3-5 4.5 7.6-1.5 2.6Z" /><path fill="#fff" d="m13.4 10.1 1.6.1-5.2 8.8-1.3-.8Zm3.6 0 1.6.1-6.5 11.2h-1.5Z" /></svg>}
    {chain === 'hypercore' && <svg viewBox="0 0 32 32"><path fill="#0b2e2a" d="M5 16c0-5 2.6-8.5 6.4-8.5 3.4 0 4.5 2.6 4.6 4.5.1-1.9 1.2-4.5 4.6-4.5 3.8 0 6.4 3.5 6.4 8.5s-2.6 8.5-6.4 8.5c-3.4 0-4.5-2.6-4.6-4.5-.1 1.9-1.2 4.5-4.6 4.5C7.6 24.5 5 21 5 16Z" /></svg>}
    {chain === 'hedera' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M11 8v16M21 8v16M11 13.5h10M11 18.5h10" /></svg>}
    {chain === 'flow' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22.5 8.5H19a4 4 0 0 0-4 4V20a3.5 3.5 0 0 1-3.5 3.5H9M11 15h10" /></svg>}
    {chain === 'stacks' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m11 8 5 6.5L21 8M11 24l5-6.5 5 6.5M8 14.5h16M8 17.5h16" /></svg>}
    {chain === 'filecoin' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M21 8.5c-3.5-1-5.5.5-6.3 4.5l-2.4 9c-.8 3-2.5 3.8-4.3 3.5M10.5 14.5h11M10 18.5l11 1.5" /></svg>}
    {chain === 'tezos' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10 9h12l-7 7c4.5 0 7 2.3 7 5s-2 4.5-5 4.5-4.5-1.6-4.5-3.6M14 6v15" /></svg>}
    {chain === 'ton' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round"><path d="M8.5 9h15L16 24.5ZM16 9v15.5" /></svg>}
    {chain === 'cardano' && <svg viewBox="0 0 32 32" fill="#fff">{[[16, 6.5, 1.6], [16, 25.5, 1.6], [7.8, 11.2, 1.6], [24.2, 11.2, 1.6], [7.8, 20.8, 1.6], [24.2, 20.8, 1.6], [12, 12.6, 1.9], [20, 12.6, 1.9], [12, 19.4, 1.9], [20, 19.4, 1.9], [16, 10.2, 1.3], [16, 21.8, 1.3], [9.9, 16, 1.3], [22.1, 16, 1.3]].map(([x, y, r]) => <circle key={`${x}${y}`} cx={x} cy={y} r={r} />)}</svg>}
    {chain === 'stellar' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M23.5 10.5a8.5 8.5 0 0 0-15 6.2M8.5 21.5a8.5 8.5 0 0 0 15-6.2M5.5 19.5l21-9.5M5.5 23l21-9.5" /></svg>}
    {chain === 'near' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 23V9l12 14V9" /></svg>}
    {chain === 'multiversx' && <svg viewBox="0 0 32 32" fill="none" stroke="#0b0b0b" strokeWidth="2.8" strokeLinecap="round"><path d="m9 9 14 14M23 9l-4.5 4.5M13.5 18.5 9 23" /></svg>}
    {chain === 'algorand' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 24 15.5 8 24 24M11.5 17.5h6M19 8l-4 16" /></svg>}
    {chain === 'cosmos' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="1.6"><ellipse cx="16" cy="16" rx="11" ry="4.2" transform="rotate(60 16 16)" /><ellipse cx="16" cy="16" rx="11" ry="4.2" transform="rotate(-60 16 16)" /><circle cx="16" cy="16" r="2.2" fill="#fff" stroke="none" /></svg>}
    {chain === 'celestia' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="16" cy="16" r="9" /><circle cx="16" cy="16" r="3.2" fill="#fff" stroke="none" /></svg>}
    {chain === 'kava' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 8v16M22 8l-8 8 8 8" /></svg>}
    {chain === 'axelar' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 8h5l3 3 3-3h5v5l-3 3 3 3v5h-5l-3-3-3 3H8v-5l3-3-3-3Z" /></svg>}
    {chain === 'injective' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 8.5a8.5 8.5 0 0 0 0 15M20 8.5a8.5 8.5 0 0 1 0 15M16 10v12" /></svg>}
    {chain === 'sei' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="16" cy="16" r="9.5" /><path d="M8 17.5c2.5-3 4.5-3 6.5-1s4 2 6.5-1 2.5-1.5 3-1" /></svg>}
    {chain === 'optimism' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M11.3 20.6c-1.1 0-2-.3-2.7-.8-.7-.5-1-1.3-1-2.3l.1-.8.6-2.8c.4-1.9 1.6-2.8 3.5-2.8 1.1 0 1.9.3 2.6.8.6.5 1 1.2 1 2.2l-.1.9-.6 2.7c-.2 1-.6 1.7-1.3 2.2-.6.5-1.3.7-2.1.7Zm.2-1.7c.4 0 .8-.1 1.1-.4.3-.2.5-.6.6-1.1l.6-2.7v-.6c0-.7-.4-1.1-1.1-1.1-.4 0-.8.1-1.1.4-.3.2-.5.6-.6 1.1l-.6 2.7-.1.6c0 .7.4 1.1 1.2 1.1Zm4.5 1.5-.1-.2 1.8-8.4.2-.1h3.4c1 0 1.7.2 2.3.6.6.4.8 1 .8 1.7l-.1.7c-.2.9-.6 1.6-1.2 2.1-.6.4-1.5.7-2.5.7h-1.7l-.6 2.8-.2.1Zm4.5-4.6c.4 0 .7-.1.9-.3.3-.2.5-.5.6-.9v-.5c0-.3-.1-.5-.3-.6-.2-.2-.5-.2-.9-.2h-1.5l-.5 2.5Z" /></svg>}
    {chain === 'zksync' && <svg viewBox="0 0 32 32" fill="#fff"><path d="m27 16-6.4-6.3v4.6l-6.3 4.6h6.3v3.4Zm-22 0 6.4 6.3v-4.6l6.3-4.7h-6.3V9.6Z" /></svg>}
    {chain === 'scroll' && <svg viewBox="0 0 32 32" fill="none" stroke="#3b2b1e" strokeWidth="1.8" strokeLinecap="round"><path d="M10 8.5h11.5a2.5 2.5 0 0 1 2.5 2.5v9.5" /><path d="M10 8.5A2.5 2.5 0 0 0 7.5 11v1.5H10M10 8.5a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5V20.5H17V22a2.5 2.5 0 0 1-2 2.5" /></svg>}
    {chain === 'ethereumclassic' && <svg viewBox="0 0 32 32"><path fill="#fff" d="M16 3 7.5 16.6 16 12.8l8.5 3.8Z" /><path fill="#d3f5d0" d="m7.5 16.6 8.5 4.9 8.5-4.9-8.5-3.8Z" /><path fill="#fff" d="m7.5 18.8 8.5 10.2 8.5-10.2-8.5 4.9Z" /></svg>}
    {chain === 'sonic' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M6.5 16c3.5-6 7-6 9.5 0s6 6 9.5 0" /><path d="M6.5 21c3.5-6 7-6 9.5 0s6 6 9.5 0" opacity=".55" /><path d="M6.5 11c3.5-6 7-6 9.5 0s6 6 9.5 0" opacity=".55" /></svg>}
    {chain === 'cronos' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"><path d="m16 5 9.5 5.5v11L16 27l-9.5-5.5v-11Z" /><path d="M19.6 13.2 16 11.1l-4.5 2.6v4.6l4.5 2.6 3.6-2.1" /></svg>}
    {chain === 'mantle' && <svg viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2"><circle cx="16" cy="16" r="9.5" strokeDasharray="4 2.6" /><circle cx="16" cy="16" r="4" fill="#fff" stroke="none" /></svg>}
    {chain === 'flare' && <svg viewBox="0 0 32 32" fill="#fff"><path d="M8 8.5h16.5a4.5 4.5 0 0 1-4.5 4.5H8Zm0 6.5h10a4.5 4.5 0 0 1-4.5 4.5H8Z" /><circle cx="10.3" cy="23.3" r="2.3" /></svg>}
    {chain === 'sui' && <svg viewBox="0 0 32 32"><path fill="#fff" d="M16 4.5c-.3 0-.5.1-.7.4C12.8 8 8.5 13.6 8.5 18.6a7.5 7.5 0 0 0 15 0c0-5-4.3-10.6-6.8-13.7a.9.9 0 0 0-.7-.4Z" /><path fill="none" stroke="#4da2ff" strokeWidth="1.7" strokeLinecap="round" d="M11.6 18.8c1.5-1.4 3-1.4 4.4 0s2.9 1.4 4.4 0" /></svg>}
    {chain === 'aptos' && <svg viewBox="0 0 32 32"><defs><clipPath id={id}><circle cx="16" cy="16" r="10" /></clipPath></defs><g clipPath={`url(#${id})`} fill="#fff"><path d="M4 10.6h11.2l1.4-1.6 1.4 1.6H28v1.9H4ZM4 15h7.2l1.4-1.6 1.4 1.6H28v1.9H4ZM4 19.5h13.4l1.4-1.6 1.4 1.6H28v1.9H4ZM4 24h5l1.4-1.6 1.4 1.6H28v4H4Z" /></g></svg>}
  </span>
}

/** Token badge: symbol on brand color, chain coin in the corner. */
export function TokenIcon({ token }: { token: { chain: Chain; symbol: string; color: string } }) {
  return <span className="token-icon" aria-hidden="true">
    <span className="coin coin--token" style={{ background: token.color }}><b data-len={Math.min(token.symbol.length, 5)}>{token.symbol.slice(0, 5)}</b></span>
    <span className="token-chain"><Coin chain={token.chain} /></span>
  </span>
}
