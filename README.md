# Still by ow2

Privacy first self-custody wallet that runs in the browser and installs as a PWA. 40+ mainnets, no account, no tracking, no card buying. Keys live in an encrypted vault on your device. The Node server serves the app and relays chain and price requests. [Discord](https://discord.gg/ow2)

## Run locally

Needs Node 24+ and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. `/` is the welcome page and the wallet lives at `/wallet`. Wallet stuff needs HTTPS or localhost. To test on a phone on the same Wi-Fi use `npm run dev:phone` and trust the local cert.

## Checks

```sh
npm run check   # TypeScript
npm test        # signing, submission and gateway tests against local fixtures
npm run build   # type-check + production build
```

## Deploy

### Cloudflare Workers

Cloudflare serves the Vite build as static assets and the Worker handles `/api/*`. Config is in `wrangler.jsonc`.

You can hook it to Cloudflare Workers Builds so every push to `main` deploys, or deploy by hand:

```sh
npm run build
npx wrangler login
npx wrangler deploy
```

Put provider keys in Worker secrets.

### Plain Node

Any Node host with HTTPS on a fixed domain. From the project root:

```sh
npm ci --include=dev
npm run build
npm start
```

Binds to `0.0.0.0:8080` unless you set `HOST`/`PORT`. Health check is `GET /api/health`. The process needs `dist/`, `server/` and the source tree. If there's a proxy in front, keep the original Host header and don't log RPC request bodies.

`/api` has a per-client rate limit (`STILL_RATE_LIMIT`), queues market calls and serves recently cached prices while the price API throttles you. For a public deploy you'll still want provider quotas.

The app calls same-origin `/api/rpc/*` and `/api/market/*`, so deploying only `dist/` won't work. `npm run preview` serves the build with the API locally.

Public providers work out of the box but can rate-limit. Override any of them with an HTTPS URL:

- `STILL_RPC_BITCOIN`: Esplora-compatible Bitcoin mainnet API
- `STILL_RPC_ETHEREUM`, `STILL_RPC_BASE`, `STILL_RPC_BNB`, `STILL_RPC_HYPEREVM`: EVM JSON-RPC
- `STILL_RPC_SOLANA`, `STILL_RPC_XRP`: their mainnet JSON-RPC
- `STILL_RPC_MONERO`: a monerod RPC (restricted is fine). Proxied at the site root (`/json_rpc`, `/getblocks.bin`, ...) because the wallet's WASM client drops URL paths
- `STILL_COINGECKO_DEMO_KEY` or `STILL_COINGECKO_PRO_KEY`: prices and charts
- `STILL_RATE_LIMIT`: requests per client per minute on `/api` (default 240)
- `STILL_TRUST_PROXY=1`: behind a reverse proxy, take the client IP from `X-Forwarded-For`

Keep keys in your host's secret settings. A custom RPC set inside the app is called straight from the browser, so it needs CORS.

## What it supports

Bitcoin, Ethereum, Solana, Monero, XRP Ledger, BNB Chain, Base, Arbitrum, Optimism, Polygon, Avalanche, Tron, TON, Litecoin, Dogecoin, Bitcoin Cash, Zcash, Dash, Cardano, Sui, Aptos, NEAR, Stellar, Algorand, Cosmos Hub, Hyperliquid, HyperEVM, Kaspa, Tezos, Filecoin, Hedera and more, plus tokens like USDC, USDT, LINK and wrapped BTC/ETH on the chains that carry them.

- BIP-39 recovery, multiple wallets from one phrase (with names and emoji), address book
- Live balances in your currency with 24h change, charts, QR codes, auto token discovery and manual token import
- Review step before signing, local signing
- Swaps from any coin to any coin via NEAR Intents, same-network ETH/Base swaps via Uniswap (Monero and HyperEVM can't swap)
- Connected apps through WalletConnect
- Optional account protection that wipes the vault after 5 wrong passwords in a row, and auto-lock that can lock the moment the app loses focus
- Several languages

Activity only shows transactions sent from that browser, use an explorer for incoming ones. XMR runs on monero-ts (a WASM worker, loaded only when Monero is on Home or you send XMR): the view key scans blocks on the device through the node proxy and the scan cache is stored encrypted in IndexedDB. Receive addresses and the app shell work offline; balances, quotes and sending need a provider.

## Security and privacy

- Keys are derived in the browser. EVM `m/44'/60'/0'/0/n`, Solana `m/44'/501'/n'/0'`, Bitcoin `m/84'/0'/n'/0/0`, XRP `m/44'/144'/n'/0/0`, Monero SLIP-10 ed25519 `m/44'/128'/n'` with spend key = sc_reduce32(node key) and view key = H(spend), same as Trezor, `n` from 0. Recovery uses the same paths and an empty BIP-39 passphrase.
- The phrase is encrypted with AES-256-GCM, key from PBKDF2-HMAC-SHA-256 at 600,000 iterations. The vault is tied to the site's origin and clearing site data deletes it, so keep an offline backup of the phrase and use a strong password.
- Once unlocked the keys are in browser memory. A compromised host, injected script, extension or device can grab them, so only use it on an origin, browser and device you trust.
- Privacy first. No analytics, no accounts, no fiat onramp. Whoever hosts Still can see your IP and what's in RPC requests (public addresses, swap quotes, signed transactions). A custom RPC set in the app sees those requests directly. History and settings stay in browser storage.
- Not audited. `npm test` checks signing and submission against fixtures. Everything runs on mainnet with real money, so try a new deploy with a fresh wallet and a small amount first.

MIT licensed. The Still mark is based on artwork from ow2.
