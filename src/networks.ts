export type Chain = 'bitcoin' | 'ethereum' | 'solana' | 'bnb' | 'xrp' | 'hyperevm' | 'base' | 'monero'
/** Still is mainnet only. */
export type Environment = 'main'
export type NetworkId = `${Chain}-${Environment}`
export type Addresses = { ethereum: string; solana: string; bitcoin: string; xrp: string; monero: string }
export type Network = {
  id: NetworkId
  chain: Chain
  name: string
  label: string
  symbol: string
  /** CoinGecko id for the native coin's price. */
  priceId: string
  decimals: number
  rpc: string
  chainId?: number
  genesis?: string
  explorer: string
  explorerQuery?: string
}

export const chains: Chain[] = ['bitcoin', 'ethereum', 'solana', 'bnb', 'xrp', 'hyperevm', 'base', 'monero']

export const networks: Record<NetworkId, Network> = {
  'ethereum-main': { id: 'ethereum-main', chain: 'ethereum', name: 'Ethereum', label: 'Mainnet', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://ethereum-rpc.publicnode.com', chainId: 1, explorer: 'https://etherscan.io' },
  'solana-main': { id: 'solana-main', chain: 'solana', name: 'Solana', label: 'Mainnet', symbol: 'SOL', priceId: 'solana', decimals: 9, rpc: 'https://solana-rpc.publicnode.com', genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', explorer: 'https://explorer.solana.com' },
  'bitcoin-main': { id: 'bitcoin-main', chain: 'bitcoin', name: 'Bitcoin', label: 'Mainnet', symbol: 'BTC', priceId: 'bitcoin', decimals: 8, rpc: 'https://mempool.space/api', explorer: 'https://mempool.space' },
  'xrp-main': { id: 'xrp-main', chain: 'xrp', name: 'XRP Ledger', label: 'Mainnet', symbol: 'XRP', priceId: 'ripple', decimals: 6, rpc: 'https://xrplcluster.com/', explorer: 'https://livenet.xrpl.org' },
  'bnb-main': { id: 'bnb-main', chain: 'bnb', name: 'BNB Chain', label: 'Mainnet', symbol: 'BNB', priceId: 'binancecoin', decimals: 18, rpc: 'https://bsc-rpc.publicnode.com', chainId: 56, explorer: 'https://bscscan.com' },
  'hyperevm-main': { id: 'hyperevm-main', chain: 'hyperevm', name: 'HyperEVM', label: 'Mainnet', symbol: 'HYPE', priceId: 'hyperliquid', decimals: 18, rpc: 'https://rpc.hyperliquid.xyz/evm', chainId: 999, explorer: 'https://hyperevmscan.io' },
  'monero-main': { id: 'monero-main', chain: 'monero', name: 'Monero', label: 'Mainnet', symbol: 'XMR', priceId: 'monero', decimals: 12, rpc: 'https://node.xmr.rocks/', explorer: 'https://xmrchain.net' },
  'base-main': { id: 'base-main', chain: 'base', name: 'Base', label: 'Mainnet', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://mainnet.base.org', chainId: 8453, explorer: 'https://basescan.org' },
}

export function activeNetworks(environment: Environment) {
  return chains.map((chain) => networks[`${chain}-${environment}`])
}

export function addressFor(network: Network, addresses: Addresses) {
  if (network.chain === 'solana' || network.chain === 'bitcoin' || network.chain === 'xrp' || network.chain === 'monero') return addresses[network.chain]
  return addresses.ethereum
}

export function defaultEndpoint(network: Network) {
  // The Still proxy for monerod sits at the site root, see server/monero.ts.
  if (network.chain === 'monero') return location.origin
  return new URL(`/api/rpc/${network.id}`, location.origin).href
}

export function explorerUrl(network: Network, type: 'address' | 'tx', value: string) {
  if (network.chain === 'xrp') return `${network.explorer}/${type === 'tx' ? 'transactions' : 'accounts'}/${encodeURIComponent(value)}`
  // Monero has no public address pages.
  if (network.chain === 'monero') return type === 'tx' ? `${network.explorer}/tx/${encodeURIComponent(value)}` : network.explorer
  return `${network.explorer}/${type}/${encodeURIComponent(value)}${network.explorerQuery ?? ''}`
}

export function parseAmount(text: string, decimals: number) {
  if (text.length > 36 || !/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Enter a positive amount using a decimal point.')
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > decimals) throw new Error(`Use up to ${decimals} decimal places.`)
  const amount = BigInt(whole + fraction.padEnd(decimals, '0'))
  if (!amount) throw new Error('Enter an amount greater than zero.')
  return amount
}

export function formatAmount(amount: bigint, decimals: number) {
  const padded = amount.toString().padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export function validateEndpoint(value: string) {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.hash) {
    throw new Error('Use an HTTPS RPC URL or a local HTTP endpoint.')
  }
  return url.href
}
