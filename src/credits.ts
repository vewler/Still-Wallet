/** Credits, shown in the wallet and on the about page. */
export const team = [
  ['vewler', 'Main developer'],
  ['Layton J.', 'Tester'],
] as const

export const supporters = [
  ['Michelangelo P.', 'Donator'],
] as const

/** Outside data providers. */
export const dataSources = [
  ['CoinGecko', 'API', 'Prices and charts'],
  ['Helius', 'RPC', 'Solana network'],
  ['Blockscout', 'API', 'Token discovery'],
  ['Routescan', 'API', 'Token discovery on Avalanche'],
  ['Uniswap', 'Token list', 'Token discovery fallback'],
  ['PancakeSwap', 'Token list', 'Token discovery on BNB Chain'],
  ['TronGrid', 'API', 'Token discovery on Tron'],
] as const

/** Open source deps, shown in Settings > Credits and on the landing page. */
export const credits = [
  ['React', 'MIT', 'Interface'],
  ['Vite', 'MIT', 'Build tooling'],
  ['vite-plugin-pwa', 'MIT', 'Offline app support'],
  ['viem', 'MIT', 'Ethereum, Base, BNB Chain and HyperEVM'],
  ['Solana Kit', 'MIT', 'Solana'],
  ['@solana-program/system', 'Apache-2.0', 'Solana transfers'],
  ['@solana-program/token', 'Apache-2.0', 'Solana token transfers'],
  ['Sui TypeScript SDK', 'Apache-2.0', 'Sui transfers'],
  ['@scure/btc-signer', 'MIT', 'Bitcoin transaction signing'],
  ['XRP Ledger codecs and keypairs', 'ISC', 'XRP transfers'],
  ['@scure/bip39', 'MIT', 'Recovery phrases'],
  ['@scure/bip32 + base', 'MIT', 'Bitcoin and XRP keys'],
  ['@noble/hashes', 'MIT', 'Hashing'],
  ['@noble/curves', 'MIT', 'Signatures, Aptos transfers'],
  ['Lucide', 'ISC', 'Icons'],
  ['qrcode', 'MIT', 'QR codes'],
  ['WalletConnect WalletKit', 'WalletConnect Community License', 'Connected apps'],
  ['jsQR', 'Apache-2.0', 'QR code scanning'],
  ['Inter', 'OFL-1.1', 'Typeface'],
] as const
