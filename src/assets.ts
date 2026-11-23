import { activeNetworks, type Chain, type Environment, type NetworkId } from './networks'
import { tokensFor, type Token } from './tokens'

/** One asset row: a native coin or a token. */
export type Asset = {
  /** The network id for native coins, `${network}:${symbol}` for tokens. */
  id: string
  network: NetworkId
  chain: Chain
  symbol: string
  name: string
  decimals: number
  priceId: string
  token?: Token
}

export function allAssets(environment: Environment): Asset[] {
  const natives = activeNetworks(environment).map((network): Asset => ({
    id: network.id, network: network.id, chain: network.chain, symbol: network.symbol, name: network.name, decimals: network.decimals, priceId: network.priceId,
  }))
  const tokens = tokensFor(environment).map((token): Asset => ({
    id: token.id, network: token.network, chain: token.chain, symbol: token.symbol, name: token.name, decimals: token.decimals, priceId: token.priceId, token,
  }))
  return [...natives, ...tokens]
}

/** Default coins for new wallets. The rest are in Manage. */
export const defaultShown = ['bitcoin-main', 'ethereum-main', 'solana-main', 'ethereum-main:USDC', 'ethereum-main:USDT']

export type AssetLayout = { order: string[]; shown: string[] }
export const defaultLayout: AssetLayout = { order: defaultShown, shown: defaultShown }

/** Saved order first, then new assets, each marked shown or hidden. */
export function arrangeAssets(environment: Environment, layout: AssetLayout) {
  return arrangeList(allAssets(environment), layout)
}

/** Sort by a saved layout (Home, Charts). */
export function arrangeList(all: Asset[], layout: AssetLayout) {
  const rank = (id: string) => { const index = layout.order.indexOf(id); return index === -1 ? 1000 + all.findIndex((asset) => asset.id === id) : index }
  return [...all].sort((a, b) => rank(a.id) - rank(b.id)).map((asset) => ({ asset, shown: layout.shown.includes(asset.id) }))
}
