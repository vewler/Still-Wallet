# Still by ow2

Self-custody wallet for eight mainnets that runs in the browser and installs as a PWA. Keys live in an encrypted vault on your device. The Node server serves the app and relays chain and price requests. Try it at [stillwallet.net](https://stillwallet.net). [Discord](https://discord.gg/ow2)

## Run locally

Needs Node 24+ and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. With no wallet you get the welcome page, once a vault is saved `/` opens the wallet. Wallet stuff needs HTTPS or localhost. To test on a phone on the same Wi-Fi use `npm run dev:phone` and trust the local cert.

## Checks

```sh
npm run check   # TypeScript
npm test        # signing, submission and gateway tests against local fixtures
npm run build   # type-check + production build
```

## Deploy

### Cloudflare Workers

Live at [stillwallet.net](https://stillwallet.net). Cloudflare serves the Vite build as static assets and the Worker handles `/api/*`. Config is in `wrangler.jsonc`.

```sh
npm run build
npx wrangler login
npx wrangler deploy
```

Put provider keys in Worker secrets.

### Vercel

The `still-by-ow2` project builds with Node 24 + Vite and serves it at [still-by-ow2.vercel.app](https://still-by-ow2.vercel.app/). `/api/` goes to the same gateway.

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

| Mainnet | Send and receive | Same-network swap |
| --- | --- | --- |
| Bitcoin | BTC | |
| Ethereum | ETH, USDC, USDT, LINK, DAI | Listed Ethereum assets via Uniswap v2 |
| Solana | SOL, USDC, USDT | |
| Base | ETH, USDC | ETH and USDC via Uniswap v2 |
| BNB Chain | BNB | |
| HyperEVM | HYPE | |
| XRP Ledger | XRP, with optional destination tags | |
| Monero | XMR | |

BIP-39 recovery, multiple wallets from one phrase (with names and emoji), live balances in your currency with 24h change, charts, QR codes, a review step before signing, local signing. Optional account protection wipes the vault after 5 wrong passwords in a row, and auto-lock can be set to lock the moment the app loses focus. Activity only shows transactions sent from that browser, use an explorer for incoming ones.

BTC sends spend confirmed outputs of the shown address. Solana token sends use the associated token account and show the SOL rent if the recipient doesn't have one yet. Swaps need liquidity, show a minimum output at 1% slippage, and might need a separate approval first. XMR runs on monero-ts (a 3.7 MB WASM worker, loaded only when Monero is on Home or you send XMR): the view key scans blocks on the device through the node proxy, the scan cache is stored encrypted in IndexedDB, and sends use the wallet's normal RingCT transactions and fee. Scanning starts at block 3,812,000, when Still added XMR, so XMR sent to this phrase earlier (e.g. via a Trezor) won't show. Receive addresses and the app shell work offline; balances, quotes and sending need a provider.

## Security and privacy

- Keys are derived in the browser. EVM `m/44'/60'/0'/0/n`, Solana `m/44'/501'/n'/0'`, Bitcoin `m/84'/0'/n'/0/0`, XRP `m/44'/144'/n'/0/0`, Monero SLIP-10 ed25519 `m/44'/128'/n'` with spend key = sc_reduce32(node key) and view key = H(spend), same as Trezor, `n` from 0. Recovery uses the same paths and an empty BIP-39 passphrase.
- The phrase is encrypted with AES-256-GCM, key from PBKDF2-HMAC-SHA-256 at 600,000 iterations. The vault is tied to the site's origin and clearing site data deletes it, so keep an offline backup of the phrase and use a strong password.
- Once unlocked the keys are in browser memory. A compromised host, injected script, extension or device can grab them, so only use it on an origin, browser and device you trust.
- No analytics. Whoever hosts Still can see your IP and what's in RPC requests (public addresses, swap quotes, signed transactions). A custom RPC set in the app sees those requests directly. History and settings stay in browser storage.
- Not audited. `npm test` checks signing and submission against fixtures. Everything runs on mainnet with real money, so try a new deploy with a fresh wallet and a small amount first.

MIT licensed. The Still mark is based on artwork from ow2.
