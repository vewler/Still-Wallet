export type Chain = 'bitcoin' | 'ethereum' | 'solana' | 'bnb' | 'xrp' | 'hyperevm' | 'base' | 'monero' | 'dogecoin' | 'tron' | 'litecoin' | 'avalanche' | 'polygon' | 'arbitrum' | 'optimism'
  | 'ethereumclassic' | 'sonic' | 'cronos' | 'mantle' | 'flare' | 'zksync' | 'scroll' | 'sui' | 'aptos' | L1Chain
  | 'bitcoincash' | 'dash' | 'zcash' | 'kaspa'
/** Still is mainnet only. */
export type Environment = 'main'
export type NetworkId = `${Chain}-${Environment}`
export type Addresses = { ethereum: string; solana: string; bitcoin: string; xrp: string; monero: string; dogecoin: string; litecoin: string; tron: string; sui: string; aptos: string
  bitcoincash: string; dash: string; zcash: string; kaspa: string
  /** Hex public key, Aptos test runs need it. */
  aptosPublicKey: string } & Record<Exclude<L1Chain, 'sei' | 'hypercore' | 'hedera' | 'flow'>, string>
/** Chains with their own address, the rest share the Ethereum one. */
/** Non-EVM layer 1s handled in src/l1 (Sei is EVM). */
export type L1Chain = 'stellar' | 'near' | 'multiversx' | 'algorand' | 'cosmos' | 'celestia' | 'kava' | 'axelar' | 'injective' | 'sei' | 'cardano' | 'hypercore' | 'ton' | 'tezos' | 'hedera' | 'flow' | 'filecoin' | 'stacks'
export const l1Chains = new Set<Chain>(['hypercore', 'ton', 'tezos', 'filecoin', 'stacks', 'cardano', 'stellar', 'near', 'multiversx', 'algorand', 'cosmos', 'celestia', 'kava', 'axelar', 'injective'])
const ownAddress = new Set<Chain>(['solana', 'bitcoin', 'xrp', 'monero', 'dogecoin', 'litecoin', 'tron', 'sui', 'aptos', 'bitcoincash', 'dash', 'zcash', 'kaspa', ...[...l1Chains].filter((chain) => chain !== 'hypercore')])
/** Bitcoin-style chains, read through an Esplora-style API. */
export const utxoChains = new Set<Chain>(['bitcoin', 'litecoin', 'dogecoin', 'bitcoincash', 'dash', 'zcash'])
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
  /** Transfers can carry a memo (exchanges often need one). */
  memo?: boolean
  addressHint?: string
}

export const chains: Chain[] = ['bitcoin', 'ethereum', 'solana', 'bnb', 'xrp', 'dogecoin', 'tron', 'litecoin', 'bitcoincash', 'dash', 'zcash', 'kaspa', 'avalanche', 'polygon', 'arbitrum', 'optimism', 'zksync', 'scroll', 'ethereumclassic', 'sonic', 'cronos', 'mantle', 'flare', 'sui', 'aptos', 'hyperevm', 'hypercore', 'base', 'monero', 'cardano', 'ton', 'stellar', 'tezos', 'filecoin', 'stacks', 'hedera', 'flow', 'near', 'cosmos', 'injective', 'celestia', 'sei', 'algorand', 'multiversx', 'kava', 'axelar']

export const networks: Record<NetworkId, Network> = {
  'ethereum-main': { id: 'ethereum-main', chain: 'ethereum', name: 'Ethereum', label: 'Mainnet', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://ethereum-rpc.publicnode.com', chainId: 1, explorer: 'https://etherscan.io' },
  'solana-main': { id: 'solana-main', chain: 'solana', name: 'Solana', label: 'Mainnet', symbol: 'SOL', priceId: 'solana', decimals: 9, rpc: 'https://solana-rpc.publicnode.com', genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', explorer: 'https://explorer.solana.com' },
  'bitcoin-main': { id: 'bitcoin-main', chain: 'bitcoin', name: 'Bitcoin', label: 'Mainnet', symbol: 'BTC', priceId: 'bitcoin', decimals: 8, rpc: 'https://mempool.space/api', explorer: 'https://mempool.space' },
  'xrp-main': { id: 'xrp-main', chain: 'xrp', name: 'XRP Ledger', label: 'Mainnet', symbol: 'XRP', priceId: 'ripple', decimals: 6, rpc: 'https://xrplcluster.com/', explorer: 'https://livenet.xrpl.org' },
  'bnb-main': { id: 'bnb-main', chain: 'bnb', name: 'BNB Chain', label: 'Mainnet', symbol: 'BNB', priceId: 'binancecoin', decimals: 18, rpc: 'https://bsc-rpc.publicnode.com', chainId: 56, explorer: 'https://bscscan.com' },
  'hyperevm-main': { id: 'hyperevm-main', chain: 'hyperevm', name: 'HyperEVM', label: 'Mainnet', symbol: 'HYPE', priceId: 'hyperliquid', decimals: 18, rpc: 'https://rpc.hyperliquid.xyz/evm', chainId: 999, explorer: 'https://hyperevmscan.io' },
  'monero-main': { id: 'monero-main', chain: 'monero', name: 'Monero', label: 'Mainnet', symbol: 'XMR', priceId: 'monero', decimals: 12, rpc: 'https://node.xmr.rocks/', explorer: 'https://xmrchain.net' },
  'base-main': { id: 'base-main', chain: 'base', name: 'Base', label: 'Mainnet', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://mainnet.base.org', chainId: 8453, explorer: 'https://basescan.org' },
  'dogecoin-main': { id: 'dogecoin-main', chain: 'dogecoin', name: 'Dogecoin', label: 'Mainnet', symbol: 'DOGE', priceId: 'dogecoin', decimals: 8, rpc: 'https://api.bitcore.io/api/DOGE/mainnet', explorer: 'https://blockchair.com/dogecoin' },
  'tron-main': { id: 'tron-main', chain: 'tron', name: 'Tron', label: 'Mainnet', symbol: 'TRX', priceId: 'tron', decimals: 6, rpc: 'https://tron-rpc.publicnode.com', explorer: 'https://tronscan.org/#' },
  'litecoin-main': { id: 'litecoin-main', chain: 'litecoin', name: 'Litecoin', label: 'Mainnet', symbol: 'LTC', priceId: 'litecoin', decimals: 8, rpc: 'https://litecoinspace.org/api', explorer: 'https://litecoinspace.org' },
  'bitcoincash-main': { id: 'bitcoincash-main', chain: 'bitcoincash', name: 'Bitcoin Cash', label: 'Mainnet', symbol: 'BCH', priceId: 'bitcoin-cash', decimals: 8, rpc: 'https://api.bitcore.io/api/BCH/mainnet', explorer: 'https://blockchair.com/bitcoin-cash', addressHint: 'Bitcoin Cash address' },
  'dash-main': { id: 'dash-main', chain: 'dash', name: 'Dash', label: 'Mainnet', symbol: 'DASH', priceId: 'dash', decimals: 8, rpc: 'https://insight.dash.org/insight-api', explorer: 'https://blockchair.com/dash', addressHint: 'Dash address (X…)' },
  'zcash-main': { id: 'zcash-main', chain: 'zcash', name: 'Zcash', label: 'Transparent', symbol: 'ZEC', priceId: 'zcash', decimals: 8, rpc: 'https://api.blockchair.com/zcash', explorer: 'https://blockchair.com/zcash', addressHint: 'Transparent Zcash address (t1…)' },
  'kaspa-main': { id: 'kaspa-main', chain: 'kaspa', name: 'Kaspa', label: 'Mainnet', symbol: 'KAS', priceId: 'kaspa', decimals: 8, rpc: 'https://api.kaspa.org', explorer: 'https://explorer.kaspa.org', addressHint: 'Kaspa address (kaspa:…)' },
  'avalanche-main': { id: 'avalanche-main', chain: 'avalanche', name: 'Avalanche', label: 'C-Chain', symbol: 'AVAX', priceId: 'avalanche-2', decimals: 18, rpc: 'https://avalanche-c-chain-rpc.publicnode.com', chainId: 43114, explorer: 'https://snowtrace.io' },
  'polygon-main': { id: 'polygon-main', chain: 'polygon', name: 'Polygon', label: 'Mainnet', symbol: 'POL', priceId: 'polygon-ecosystem-token', decimals: 18, rpc: 'https://polygon-bor-rpc.publicnode.com', chainId: 137, explorer: 'https://polygonscan.com' },
  'arbitrum-main': { id: 'arbitrum-main', chain: 'arbitrum', name: 'Arbitrum', label: 'One', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://arbitrum-one-rpc.publicnode.com', chainId: 42161, explorer: 'https://arbiscan.io' },
  'optimism-main': { id: 'optimism-main', chain: 'optimism', name: 'Optimism', label: 'Mainnet', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://optimism-rpc.publicnode.com', chainId: 10, explorer: 'https://optimistic.etherscan.io' },
  'zksync-main': { id: 'zksync-main', chain: 'zksync', name: 'ZKsync', label: 'Era', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://mainnet.era.zksync.io', chainId: 324, explorer: 'https://explorer.zksync.io' },
  'scroll-main': { id: 'scroll-main', chain: 'scroll', name: 'Scroll', label: 'Mainnet', symbol: 'ETH', priceId: 'ethereum', decimals: 18, rpc: 'https://rpc.scroll.io', chainId: 534352, explorer: 'https://scrollscan.com' },
  'ethereumclassic-main': { id: 'ethereumclassic-main', chain: 'ethereumclassic', name: 'Ethereum Classic', label: 'Mainnet', symbol: 'ETC', priceId: 'ethereum-classic', decimals: 18, rpc: 'https://etc.drpc.org', chainId: 61, explorer: 'https://etc.blockscout.com' },
  'sonic-main': { id: 'sonic-main', chain: 'sonic', name: 'Sonic', label: 'Mainnet', symbol: 'S', priceId: 'sonic-3', decimals: 18, rpc: 'https://rpc.soniclabs.com', chainId: 146, explorer: 'https://sonicscan.org' },
  'cronos-main': { id: 'cronos-main', chain: 'cronos', name: 'Cronos', label: 'EVM', symbol: 'CRO', priceId: 'crypto-com-chain', decimals: 18, rpc: 'https://evm.cronos.org', chainId: 25, explorer: 'https://explorer.cronos.org' },
  'mantle-main': { id: 'mantle-main', chain: 'mantle', name: 'Mantle', label: 'Mainnet', symbol: 'MNT', priceId: 'mantle', decimals: 18, rpc: 'https://rpc.mantle.xyz', chainId: 5000, explorer: 'https://mantlescan.xyz' },
  'flare-main': { id: 'flare-main', chain: 'flare', name: 'Flare', label: 'Mainnet', symbol: 'FLR', priceId: 'flare-networks', decimals: 18, rpc: 'https://flare-api.flare.network/ext/C/rpc', chainId: 14, explorer: 'https://flare-explorer.flare.network' },
  'sui-main': { id: 'sui-main', chain: 'sui', name: 'Sui', label: 'Mainnet', symbol: 'SUI', priceId: 'sui', decimals: 9, rpc: 'https://graphql.mainnet.sui.io/graphql', explorer: 'https://suiscan.xyz/mainnet' },
  'aptos-main': { id: 'aptos-main', chain: 'aptos', name: 'Aptos', label: 'Mainnet', symbol: 'APT', priceId: 'aptos', decimals: 8, rpc: 'https://api.mainnet.aptoslabs.com/v1', explorer: 'https://explorer.aptoslabs.com', explorerQuery: '?network=mainnet' },
  'hypercore-main': { id: 'hypercore-main', chain: 'hypercore', name: 'Hyperliquid', label: 'HyperCore', symbol: 'HYPE', priceId: 'hyperliquid', decimals: 8, rpc: 'https://api.hyperliquid.xyz', explorer: 'https://app.hyperliquid.xyz/explorer' },
  'ton-main': { id: 'ton-main', chain: 'ton', name: 'TON', label: 'Mainnet', symbol: 'TON', priceId: 'the-open-network', decimals: 9, rpc: 'https://toncenter.com/api', explorer: 'https://tonviewer.com', memo: true, addressHint: 'TON address (UQ… or EQ…)' },
  'tezos-main': { id: 'tezos-main', chain: 'tezos', name: 'Tezos', label: 'Mainnet', symbol: 'XTZ', priceId: 'tezos', decimals: 6, rpc: 'https://rpc.tzkt.io/mainnet', explorer: 'https://tzkt.io', addressHint: 'Tezos address (tz1…)' },
  'cardano-main': { id: 'cardano-main', chain: 'cardano', name: 'Cardano', label: 'Mainnet', symbol: 'ADA', priceId: 'cardano', decimals: 6, rpc: 'https://api.koios.rest/api/v1', explorer: 'https://cardanoscan.io', addressHint: 'Cardano address (addr1…)' },
  'stellar-main': { id: 'stellar-main', chain: 'stellar', name: 'Stellar', label: 'Mainnet', symbol: 'XLM', priceId: 'stellar', decimals: 7, rpc: 'https://horizon.stellar.org', explorer: 'https://stellar.expert/explorer/public', memo: true, addressHint: 'Stellar address (G…)' },
  'near-main': { id: 'near-main', chain: 'near', name: 'NEAR', label: 'Mainnet', symbol: 'NEAR', priceId: 'near', decimals: 24, rpc: 'https://free.rpc.fastnear.com', explorer: 'https://nearblocks.io', addressHint: 'name.near or implicit account' },
  'multiversx-main': { id: 'multiversx-main', chain: 'multiversx', name: 'MultiversX', label: 'Mainnet', symbol: 'EGLD', priceId: 'elrond-erd-2', decimals: 18, rpc: 'https://gateway.multiversx.com', explorer: 'https://explorer.multiversx.com', memo: true, addressHint: 'MultiversX address (erd1…)' },
  'algorand-main': { id: 'algorand-main', chain: 'algorand', name: 'Algorand', label: 'Mainnet', symbol: 'ALGO', priceId: 'algorand', decimals: 6, rpc: 'https://mainnet-api.algonode.cloud', explorer: 'https://allo.info', memo: true, addressHint: 'Algorand address' },
  'cosmos-main': { id: 'cosmos-main', chain: 'cosmos', name: 'Cosmos Hub', label: 'Mainnet', symbol: 'ATOM', priceId: 'cosmos', decimals: 6, rpc: 'https://cosmos-rest.publicnode.com', explorer: 'https://www.mintscan.io/cosmos', memo: true, addressHint: 'Cosmos address (cosmos1…)' },
  'celestia-main': { id: 'celestia-main', chain: 'celestia', name: 'Celestia', label: 'Mainnet', symbol: 'TIA', priceId: 'celestia', decimals: 6, rpc: 'https://celestia-rest.publicnode.com', explorer: 'https://www.mintscan.io/celestia', memo: true, addressHint: 'Celestia address (celestia1…)' },
  'kava-main': { id: 'kava-main', chain: 'kava', name: 'Kava', label: 'Mainnet', symbol: 'KAVA', priceId: 'kava', decimals: 6, rpc: 'https://kava-rest.publicnode.com', explorer: 'https://www.mintscan.io/kava', memo: true, addressHint: 'Kava address (kava1…)' },
  'axelar-main': { id: 'axelar-main', chain: 'axelar', name: 'Axelar', label: 'Mainnet', symbol: 'AXL', priceId: 'axelar', decimals: 6, rpc: 'https://axelar-rest.publicnode.com', explorer: 'https://www.mintscan.io/axelar', memo: true, addressHint: 'Axelar address (axelar1…)' },
  'injective-main': { id: 'injective-main', chain: 'injective', name: 'Injective', label: 'Mainnet', symbol: 'INJ', priceId: 'injective-protocol', decimals: 18, rpc: 'https://injective-rest.publicnode.com', explorer: 'https://www.mintscan.io/injective', memo: true, addressHint: 'Injective address (inj1…)' },
  'filecoin-main': { id: 'filecoin-main', chain: 'filecoin', name: 'Filecoin', label: 'Mainnet', symbol: 'FIL', priceId: 'filecoin', decimals: 18, rpc: 'https://api.node.glif.io/rpc/v1', explorer: 'https://filfox.info/en', addressHint: 'Filecoin address (f1…, f410…)' },
  'stacks-main': { id: 'stacks-main', chain: 'stacks', name: 'Stacks', label: 'Mainnet', symbol: 'STX', priceId: 'blockstack', decimals: 6, rpc: 'https://api.mainnet.hiro.so', explorer: 'https://explorer.hiro.so', explorerQuery: '?chain=mainnet', memo: true, addressHint: 'Stacks address (SP…)' },
  'hedera-main': { id: 'hedera-main', chain: 'hedera', name: 'Hedera', label: 'EVM', symbol: 'HBAR', priceId: 'hedera-hashgraph', decimals: 18, rpc: 'https://mainnet.hashio.io/api', chainId: 295, explorer: 'https://hashscan.io/mainnet' },
  'flow-main': { id: 'flow-main', chain: 'flow', name: 'Flow', label: 'EVM', symbol: 'FLOW', priceId: 'flow', decimals: 18, rpc: 'https://mainnet.evm.nodes.onflow.org', chainId: 747, explorer: 'https://evm.flowscan.io' },
  'sei-main': { id: 'sei-main', chain: 'sei', name: 'Sei', label: 'Mainnet', symbol: 'SEI', priceId: 'sei-network', decimals: 18, rpc: 'https://evm-rpc.sei-apis.com', chainId: 1329, explorer: 'https://seitrace.com', explorerQuery: '?chain=pacific-1' },
}

/** Networks swaps work on (NEAR Intents). Monero and HyperEVM aren't supported there. */
export const crossNetworks: NetworkId[] = ['bitcoin-main', 'ethereum-main', 'solana-main', 'bnb-main', 'xrp-main', 'base-main', 'dogecoin-main', 'tron-main', 'litecoin-main', 'bitcoincash-main', 'zcash-main', 'avalanche-main', 'polygon-main', 'arbitrum-main', 'optimism-main', 'scroll-main', 'sui-main', 'aptos-main', 'cardano-main', 'dash-main', 'stellar-main']

/** CoinGecko asset platforms, used to price imported tokens by contract. */
export const pricePlatforms: Partial<Record<NetworkId, string>> = {
  'ethereum-main': 'ethereum', 'bnb-main': 'binance-smart-chain', 'base-main': 'base', 'arbitrum-main': 'arbitrum-one', 'optimism-main': 'optimistic-ethereum',
  'polygon-main': 'polygon-pos', 'avalanche-main': 'avalanche', 'hyperevm-main': 'hyperevm', 'solana-main': 'solana',
  'zksync-main': 'zksync', 'scroll-main': 'scroll', 'ethereumclassic-main': 'ethereum-classic', 'sonic-main': 'sonic',
  'cronos-main': 'cronos', 'mantle-main': 'mantle', 'flare-main': 'flare-network', 'tron-main': 'tron',
}
/** Networks that can hold imported tokens (EVM chains, Solana and Tron). */
export const importNetworks = Object.keys(pricePlatforms) as NetworkId[]
/** Explorers that list an address's tokens (Blockscout; PancakeSwap's token list on BNB Chain; Routescan token transfers on Avalanche; TronGrid for Tron). */
export const tokenExplorers: Partial<Record<NetworkId, string>> = {
  'ethereum-main': 'eth.blockscout.com', 'base-main': 'base.blockscout.com', 'optimism-main': 'optimism.blockscout.com',
  'arbitrum-main': 'arbitrum.blockscout.com', 'polygon-main': 'polygon.blockscout.com',
  'tron-main': 'api.trongrid.io', 'bnb-main': 'tokens.pancakeswap.finance', 'avalanche-main': 'api.routescan.io/v2/network/mainnet/evm/43114', 'zksync-main': 'zksync.blockscout.com', 'ethereumclassic-main': 'etc.blockscout.com',
}

export function activeNetworks(environment: Environment) {
  return chains.map((chain) => networks[`${chain}-${environment}`])
}

export function addressFor(network: Network, addresses: Addresses) {
  return ownAddress.has(network.chain) ? addresses[network.chain as keyof Addresses] : addresses.ethereum
}

export function defaultEndpoint(network: Network) {
  // The Still proxy for monerod sits at the site root, see server/monero.ts.
  if (network.chain === 'monero') return location.origin
  return new URL(`/api/rpc/${network.id}`, location.origin).href
}

export function explorerUrl(network: Network, type: 'address' | 'tx', value: string) {
  const l1Paths: Partial<Record<Chain, [tx: string, address: string]>> = {
    hedera: ['transaction', 'account'], filecoin: ['message', 'address'], cardano: ['transaction', 'address'], stellar: ['tx', 'account'], near: ['txns', 'address'], multiversx: ['transactions', 'accounts'], algorand: ['tx', 'account'],
    cosmos: ['tx', 'address'], celestia: ['tx', 'address'], kava: ['tx', 'address'], axelar: ['tx', 'address'], injective: ['tx', 'address'],
  }
  if (network.chain === 'stacks') return `${network.explorer}/${type === 'tx' ? 'txid' : 'address'}/${encodeURIComponent(value)}${network.explorerQuery}`
  if (network.chain === 'tezos') return `${network.explorer}/${encodeURIComponent(value)}`
  if (network.chain === 'ton') return `${network.explorer}/${type === 'tx' ? 'transaction/' : ''}${encodeURIComponent(value)}`
  if (network.chain === 'hypercore') return type === 'tx' ? network.explorer : `${network.explorer}/address/${encodeURIComponent(value)}`
  const l1Path = l1Paths[network.chain]
  if (l1Path) return `${network.explorer}/${type === 'tx' ? l1Path[0] : l1Path[1]}/${encodeURIComponent(value)}`
  if (['dogecoin', 'bitcoincash', 'dash', 'zcash'].includes(network.chain)) return `${network.explorer}/${type === 'tx' ? 'transaction' : 'address'}/${encodeURIComponent(value)}`
  if (network.chain === 'tron') return `${network.explorer}/${type === 'tx' ? 'transaction' : 'address'}/${encodeURIComponent(value)}`
  if (network.chain === 'sui') return `${network.explorer}/${type === 'tx' ? 'tx' : 'account'}/${encodeURIComponent(value)}`
  if (network.chain === 'aptos') return `${network.explorer}/${type === 'tx' ? 'txn' : 'account'}/${encodeURIComponent(value)}${network.explorerQuery}`
  if (network.chain === 'kaspa') return `${network.explorer}/${type === 'tx' ? 'txs' : 'addresses'}/${encodeURIComponent(value)}`
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
