import type { Chain, Environment, NetworkId } from './networks'

/** Native issuances plus the common wrapped and bridged versions of the top coins. */
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
  /** Imported by the user or found in the wallet. Not swappable, no charts. */
  user?: 'custom' | 'found'
  /** CoinGecko knows the contract. */
  verified?: boolean
}

/** Saved per wallet. */
export type UserToken = { network: NetworkId; contract: string; symbol: string; name: string; decimals: number; user: 'custom' | 'found'; verified: boolean }

type Seed = [symbol: string, name: string, decimals: number, contract: string, priceId: string, color: string]

const usdc = (decimals: number, contract: string, name = 'USD Coin'): Seed => ['USDC', name, decimals, contract, 'usd-coin', '#2775ca']
const usdt = (decimals: number, contract: string): Seed => ['USDT', 'Tether USD', decimals, contract, 'tether', '#26a17b']
const link = (contract: string): Seed => ['LINK', 'Chainlink', 18, contract, 'chainlink', '#2a5ada']
const weth = (contract: string, symbol = 'WETH'): Seed => [symbol, 'Wrapped Ether', 18, contract, 'ethereum', '#627eea']
const wbtc = (contract: string, symbol = 'WBTC', name = 'Wrapped Bitcoin'): Seed => [symbol, name, 8, contract, 'bitcoin', '#f7931a']
const cbbtc = (contract: string): Seed => ['cbBTC', 'Coinbase Wrapped BTC', 8, contract, 'bitcoin', '#0052ff']

const seeds: Partial<Record<NetworkId, Seed[]>> = {
  'ethereum-main': [
    usdc(6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    usdt(6, '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    link('0x514910771AF9Ca656af840dff83E8264EcF986CA'),
    ['DAI', 'Dai', 18, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'dai', '#f5ac37'],
    ['UNI', 'Uniswap', 18, '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 'uniswap', '#ff007a'],
    ['AAVE', 'Aave', 18, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', 'aave', '#9b5bb5'],
    ['SHIB', 'Shiba Inu', 18, '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 'shiba-inu', '#e8890c'],
    ['PEPE', 'Pepe', 18, '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 'pepe', '#3d8130'],
    ['ENA', 'Ethena', 18, '0x57e114B691Db790C35207b2e685D4A43181e6061', 'ethena', '#2b2b2b'],
    ['ONDO', 'Ondo', 18, '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', 'ondo-finance', '#1d3fbb'],
    ['PYUSD', 'PayPal USD', 6, '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', 'paypal-usd', '#0070e0'],
    ['USDS', 'USDS', 18, '0xdC035D45d973E3EC169d2276DDab16f1e407384F', 'usds', '#f1a73b'],
    ['USDe', 'Ethena USDe', 18, '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3', 'ethena-usde', '#111111'],
    ['WBTC', 'Wrapped Bitcoin', 8, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'wrapped-bitcoin', '#f09242'],
    ['WETH', 'Wrapped Ether', 18, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'weth', '#5b6ee1'],
    ['LDO', 'Lido DAO', 18, '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', 'lido-dao', '#f69988'],
    ['SKY', 'Sky', 18, '0x56072C95FAA701256059aa122697B133aDEd9279', 'sky', '#5e4ce6'],
    ['PAXG', 'PAX Gold', 18, '0x45804880De22913dAFE09f4980848ECE6EcbAf78', 'pax-gold', '#c8a43c'],
    ['XAUt', 'Tether Gold', 6, '0x68749665FF8D2d112Fa859AA293F07A622782F38', 'tether-gold', '#b8923a'],
    ['EURC', 'Euro Coin', 6, '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', 'euro-coin', '#2775ca'],
    ['GNO', 'Gnosis', 18, '0x6810e776880C02933D47DB1b9fc05908e5386b96', 'gnosis', '#133629'],
    ['CRV', 'Curve DAO', 18, '0xD533a949740bb3306d119CC777fa900bA034cd52', 'curve-dao-token', '#3465a4'],
    ['ZRO', 'LayerZero', 18, '0x6985884C4392D348587B19cb9eAAf157F13271cd', 'layerzero', '#1a1a1a'],
    ['IMX', 'Immutable', 18, '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF', 'immutable-x', '#17b5cb'],
    ['SAND', 'The Sandbox', 18, '0x3845badAde8e6dFF049820680d1F14bD3903a5d0', 'the-sandbox', '#00adef'],
    ['MANA', 'Decentraland', 18, '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', 'decentraland', '#ff2d55'],
    ['AXS', 'Axie Infinity', 18, '0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b', 'axie-infinity', '#0055d5'],
    ['GALA', 'Gala', 8, '0xd1d2Eb1B1e90B638588728b4130137D262C87cae', 'gala', '#1b1b1b'],
    ['BAT', 'Basic Attention Token', 18, '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', 'basic-attention-token', '#ff5000'],
    ['ENS', 'Ethereum Name Service', 18, '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', 'ethereum-name-service', '#5298ff'],
    ['1INCH', '1inch', 18, '0x111111111117dC0aa78b770fA6A738034120C302', '1inch', '#1b314f'],
    ['GRT', 'The Graph', 18, '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', 'the-graph', '#6747ed'],
    ['QNT', 'Quant', 18, '0x4a220E6096B25EADb88358cb44068A3248254675', 'quant-network', '#1e1e1e'],
    ['WLD', 'Worldcoin', 18, '0x163f8C2467924be0ae7B5347228CABF260318753', 'worldcoin-wld', '#1a1a1a'],
    ['MNT', 'Mantle', 18, '0x3c3a81e81dc49A522A592e7622A7E711c06bf354', 'mantle', '#0d0d0d'],
    ['POL', 'Polygon', 18, '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6', 'polygon-ecosystem-token', '#7b3fe4'],
    cbbtc('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'),
    ['SOL', 'Wrapped SOL (Wormhole)', 9, '0xD31a59c85aE9D8edEFeC411D448f90841571b89c', 'solana', '#9945ff'],
    ['TON', 'Toncoin (bridged)', 9, '0x582d872A1B094FC48F5DE31D3B73F2D9bE47def1', 'the-open-network', '#0098ea'],
    ['BNB', 'BNB (ERC-20)', 18, '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', 'binancecoin', '#f0b90b'],
  ],
  'solana-main': [
    usdc(6, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    usdt(6, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
    ['BONK', 'Bonk', 5, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'bonk', '#f39c12'],
    ['JUP', 'Jupiter', 6, 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 'jupiter-exchange-solana', '#1ea69a'],
    ['WIF', 'dogwifhat', 6, 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 'dogwifcoin', '#a8805c'],
    ['TRUMP', 'Official Trump', 6, '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', 'official-trump', '#c9a227'],
    ['PENGU', 'Pudgy Penguins', 6, '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', 'pudgy-penguins', '#4a8fe7'],
    ['RAY', 'Raydium', 6, '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 'raydium', '#6a3fd6'],
    ['ORCA', 'Orca', 6, 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', 'orca', '#c8901a'],
    ['JTO', 'Jito', 9, 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 'jito-governance-token', '#1f9d6b'],
    ['PYTH', 'Pyth Network', 6, 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', 'pyth-network', '#7142cf'],
    ['W', 'Wormhole', 6, '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', 'wormhole', '#2b2b2b'],
    wbtc('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', 'WBTC', 'Wrapped Bitcoin (Wormhole)'),
    cbbtc('cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'),
    ['WETH', 'Wrapped Ether (Wormhole)', 8, '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 'ethereum', '#627eea'],
  ],
  'bnb-main': [
    ['CAKE', 'PancakeSwap', 18, '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 'pancakeswap-token', '#1fc7d4'],
    usdt(18, '0x55d398326f99059fF775485246999027B3197955'),
    usdc(18, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
    link('0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD'),
    ['WBNB', 'Wrapped BNB', 18, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'binancecoin', '#f0b90b'],
    ['BTCB', 'Binance-Peg Bitcoin', 18, '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 'bitcoin', '#f7931a'],
    ['ETH', 'Binance-Peg Ether', 18, '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 'ethereum', '#627eea'],
    ['SOL', 'Binance-Peg SOL', 18, '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF', 'solana', '#9945ff'],
    ['XRP', 'Binance-Peg XRP', 18, '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', 'ripple', '#23292f'],
    ['TRX', 'Binance-Peg TRON', 6, '0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3', 'tron', '#ff060a'],
    ['LTC', 'Binance-Peg Litecoin', 18, '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94', 'litecoin', '#345d9d'],
    ['ZEC', 'Binance-Peg Zcash', 18, '0x1Ba42e5193dfA8B03D15dd1B86a3113bbBEF8Eeb', 'zcash', '#f4b728'],
    ['DOGE', 'Binance-Peg Dogecoin', 8, '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', 'dogecoin', '#c2a633'],
    ['TON', 'Binance-Peg Toncoin', 9, '0x76A797A59Ba2C17726896976B7B3747BfD1d220f', 'the-open-network', '#0098ea'],
    ['AVAX', 'Binance-Peg Avalanche', 18, '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', 'avalanche-2', '#e84142'],
    ['ADA', 'Binance-Peg Cardano', 18, '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', 'cardano', '#0033ad'],
    ['BCH', 'Binance-Peg Bitcoin Cash', 18, '0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf', 'bitcoin-cash', '#8dc351'],
  ],
  'arbitrum-main': [
    ['ARB', 'Arbitrum', 18, '0x912CE59144191C1204E64559FE8253a0e49E6548', 'arbitrum', '#213147'],
    usdc(6, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    usdt(6, '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'),
    weth('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
    wbtc('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'),
    cbbtc('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'),
    link('0xf97f4df75117a78c1A5a0DBb814Af92458539FB4'),
  ],
  'zksync-main': [
    ['ZK', 'ZKsync', 18, '0x5A7d6b2F92C77FAD6CCaBd7EE0624E64907Eaf3E', 'zksync', '#1e69ff'],
    usdc(6, '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4'),
    usdt(6, '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C'),
    weth('0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91'),
  ],
  'scroll-main': [
    ['SCR', 'Scroll', 18, '0xd29687c813D741E2F938F4aC377128810E217b1b', 'scroll', '#c7956b'],
    usdc(6, '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4'),
    usdt(6, '0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df'),
    weth('0x5300000000000000000000000000000000000004'),
  ],
  'optimism-main': [
    ['OP', 'Optimism', 18, '0x4200000000000000000000000000000000000042', 'optimism', '#ff0420'],
    usdc(6, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    usdt(6, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'),
    weth('0x4200000000000000000000000000000000000006'),
    wbtc('0x68f180fcCe6836688e9084f035309E29Bf0A2095'),
    link('0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6'),
  ],
  'base-main': [
    usdc(6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    ['EURC', 'Euro Coin', 6, '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 'euro-coin', '#2775ca'],
    weth('0x4200000000000000000000000000000000000006'),
    cbbtc('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'),
    link('0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196'),
    ['cbXRP', 'Coinbase Wrapped XRP', 6, '0xcb585250f852C6c6bf90434AB21A00f02833a4af', 'ripple', '#23292f'],
    ['cbDOGE', 'Coinbase Wrapped DOGE', 8, '0xcbD06E5A2B0C65597161de254AA074E489dEb510', 'dogecoin', '#c2a633'],
    ['cbLTC', 'Coinbase Wrapped LTC', 8, '0xcb17C9Db87B595717C857a08468793f5bAb6445F', 'litecoin', '#345d9d'],
    ['cbADA', 'Coinbase Wrapped ADA', 6, '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c', 'cardano', '#0033ad'],
  ],
  'tron-main': [
    usdt(6, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  ],
  'avalanche-main': [
    usdc(6, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'),
    usdt(6, '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'),
    ['EURC', 'Euro Coin', 6, '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD', 'euro-coin', '#2775ca'],
    ['WAVAX', 'Wrapped AVAX', 18, '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 'avalanche-2', '#e84142'],
    ['BTC.b', 'Bitcoin (Avalanche Bridge)', 8, '0x152b9d0FdC40C096757F570A51E494bd4b943E50', 'bitcoin', '#f7931a'],
    wbtc('0x50b7545627a5162F82A992c33b87aDc75187B218', 'WBTC.e'),
    weth('0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', 'WETH.e'),
    ['LINK.e', 'Chainlink (bridged)', 18, '0x5947BB275c521040051D82396192181b413227A3', 'chainlink', '#2a5ada'],
  ],
  'polygon-main': [
    usdc(6, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
    usdt(6, '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
    weth('0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'),
    link('0xb0897686c545045aFc77CF20eC7A532E3120E0F1'),
    ['WPOL', 'Wrapped POL', 18, '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 'polygon-ecosystem-token', '#7b3fe4'],
  ],
  'hyperevm-main': [
    ['WHYPE', 'Wrapped HYPE', 18, '0x5555555555555555555555555555555555555555', 'hyperliquid', '#50d2c1'],
    usdt(6, '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'),
    wbtc('0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463', 'UBTC', 'Unit Bitcoin'),
    weth('0xBe6727B535545C67d5cAa73dEa54865B92CF7907', 'UETH'),
  ],
}

export const tokens: Token[] = Object.entries(seeds).flatMap(([network, list]) => list!.map(([symbol, name, decimals, contract, priceId, color]): Token => ({
  id: `${network}:${symbol}`, network: network as NetworkId, chain: network.split('-')[0] as Chain, symbol, name, decimals, contract, priceId, color,
})))

const builtIn = tokens.length

/** Case-insensitive for EVM, exact for Solana and Tron. */
export const contractKey = (_network: NetworkId, contract: string) => contract.startsWith('0x') ? contract.toLowerCase() : contract
export const userTokenId = (network: NetworkId, contract: string) => `${network}:${contractKey(network, contract)}`

/** Same contract already listed (built in or imported). */
export function knownToken(network: NetworkId, contract: string) {
  const key = contractKey(network, contract)
  return tokens.find((token) => token.network === network && contractKey(network, token.contract) === key)
}

export const tokenColor = (contract: string) => {
  let hash = 0
  for (const char of contract) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 45% 42%)`
}

/** Swap in this wallet's imported and found tokens. */
export function setUserTokens(list: UserToken[]) {
  tokens.splice(builtIn)
  for (const entry of list) {
    if (knownToken(entry.network, entry.contract)) continue
    tokens.push({
      id: userTokenId(entry.network, entry.contract), network: entry.network, chain: entry.network.split('-')[0] as Chain,
      symbol: entry.symbol, name: entry.name, decimals: entry.decimals, contract: entry.contract,
      priceId: `contract:${userTokenId(entry.network, entry.contract)}`, color: tokenColor(entry.contract), user: entry.user, verified: entry.verified,
    })
  }
}

/** Token text from chains is untrusted: no control chars, short. */
export function cleanLabel(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : ''
}

/** Names airdrop spam uses to lure people to phishing sites. */
export function looksLikeSpam(name: string, symbol: string) {
  return /https?:|www\.|\.(?:com|io|net|org|xyz|app|finance|site|online|pro|top|cc|me|gg|vip|fun|lol|live)\b|claim|reward|visit|airdrop|voucher|gift|bonus|redeem|\$\s?\d|t\.me|access|eligible/i.test(`${name} ${symbol}`)
}

/** Tokens NEAR Intents can't route, left out of Swap. */
export const unswappable = new Set(['solana-main:BONK', 'solana-main:JUP', 'solana-main:WIF', 'ethereum-main:ENA', 'ethereum-main:ONDO', 'ethereum-main:PYUSD', 'bnb-main:CAKE',
  'ethereum-main:USDS', 'ethereum-main:USDe', 'ethereum-main:LDO', 'ethereum-main:SKY', 'ethereum-main:PAXG', 'ethereum-main:EURC', 'ethereum-main:GNO', 'ethereum-main:CRV', 'ethereum-main:ZRO', 'ethereum-main:IMX', 'ethereum-main:SAND', 'ethereum-main:MANA', 'ethereum-main:AXS', 'ethereum-main:GALA', 'ethereum-main:BAT', 'ethereum-main:ENS', 'ethereum-main:1INCH', 'ethereum-main:GRT', 'ethereum-main:QNT', 'ethereum-main:WLD', 'ethereum-main:MNT', 'ethereum-main:POL', 'avalanche-main:EURC', 'base-main:EURC', 'scroll-main:SCR',
  'ethereum-main:SOL', 'ethereum-main:TON', 'ethereum-main:BNB', 'solana-main:WBTC', 'solana-main:cbBTC', 'solana-main:WETH', 'bnb-main:LINK', 'bnb-main:WBNB', 'bnb-main:BTCB', 'bnb-main:ETH', 'bnb-main:SOL', 'bnb-main:XRP', 'bnb-main:TRX', 'bnb-main:LTC', 'bnb-main:ZEC', 'bnb-main:DOGE', 'bnb-main:TON', 'bnb-main:AVAX', 'bnb-main:ADA', 'bnb-main:BCH', 'arbitrum-main:WBTC', 'arbitrum-main:cbBTC', 'arbitrum-main:LINK', 'optimism-main:WBTC', 'optimism-main:LINK', 'base-main:LINK', 'base-main:cbXRP', 'base-main:cbDOGE', 'base-main:cbLTC', 'base-main:cbADA', 'avalanche-main:WAVAX', 'avalanche-main:BTC.b', 'avalanche-main:WBTC.e', 'avalanche-main:WETH.e', 'avalanche-main:LINK.e', 'polygon-main:LINK', 'polygon-main:WPOL', 'hyperevm-main:WHYPE', 'hyperevm-main:USDT', 'hyperevm-main:UBTC', 'hyperevm-main:UETH', 'zksync-main:USDC', 'zksync-main:USDT', 'zksync-main:WETH', 'scroll-main:USDC', 'scroll-main:WETH',
  'solana-main:RAY', 'solana-main:ORCA', 'solana-main:JTO', 'solana-main:PYTH', 'solana-main:W',
])

export function tokensFor(environment: Environment) {
  return tokens.filter((token) => token.network.endsWith(`-${environment}`))
}

export function tokenById(id: string) {
  return tokens.find((token) => token.id === id)
}

export function tokenPriceIds() {
  return [...new Set(tokens.filter((token) => !token.user).map((token) => token.priceId))]
}
