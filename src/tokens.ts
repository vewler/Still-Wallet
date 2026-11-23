import type { Chain, Environment, NetworkId } from './networks'

/** Native issuances only, no bridged or wrapped versions: USDC on Ethereum/Solana/Base, USDT on Ethereum/Solana, LINK and DAI on Ethereum. */
export type Token = {
  id: string
  network: NetworkId
  chain: Chain
  symbol: string
  name: string
  decimals: number
  contract: string
  /** CoinGecko id for pricing. */
  priceId: string
  color: string
}

type Seed = [symbol: string, name: string, decimals: number, contract: string, priceId: string, color: string]

const usdc = (decimals: number, contract: string, name = 'USD Coin'): Seed => ['USDC', name, decimals, contract, 'usd-coin', '#2775ca']
const usdt = (decimals: number, contract: string): Seed => ['USDT', 'Tether USD', decimals, contract, 'tether', '#26a17b']
const link = (contract: string): Seed => ['LINK', 'Chainlink', 18, contract, 'chainlink', '#2a5ada']

const seeds: Partial<Record<NetworkId, Seed[]>> = {
  'ethereum-main': [
    usdc(6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    usdt(6, '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    link('0x514910771AF9Ca656af840dff83E8264EcF986CA'),
    ['DAI', 'Dai', 18, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'dai', '#f5ac37'],
  ],
  'solana-main': [
    usdc(6, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    usdt(6, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  ],
  'base-main': [
    usdc(6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  ],
}

export const tokens: Token[] = Object.entries(seeds).flatMap(([network, list]) => list!.map(([symbol, name, decimals, contract, priceId, color]): Token => ({
  id: `${network}:${symbol}`, network: network as NetworkId, chain: network.split('-')[0] as Chain, symbol, name, decimals, contract, priceId, color,
})))

export function tokensFor(environment: Environment) {
  return tokens.filter((token) => token.network.endsWith(`-${environment}`))
}

export function tokenById(id: string) {
  return tokens.find((token) => token.id === id)
}

export function tokenPriceIds() {
  return [...new Set(tokens.map((token) => token.priceId))]
}
