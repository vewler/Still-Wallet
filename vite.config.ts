import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { readFileSync } from 'node:fs'
import { createGateway } from './server/gateway.ts'

// Local dev uses the same public vars as the worker (WalletConnect project id, RPC overrides).
for (const [key, value] of Object.entries((JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8')) as { vars?: Record<string, string> }).vars ?? {})) process.env[key] ??= value

// Backup for the full policy in public/_headers, which also covers the key and Monero workers (a meta tag doesn't).
// connect-src stays open to https: and local http because custom RPCs can be any HTTPS host or the user's own local node.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https: wss://relay.walletconnect.org wss://relay.walletconnect.com http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig(({ mode }) => ({
  // The key worker has lazy imports, which only ES module workers can split.
  worker: { format: 'es' },
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')) },
  build: {
    rolldownOptions: {
      output: {
        // WalletConnect chunks get their own prefix so the service worker can leave them to load on demand.
        chunkFileNames: (chunk) => chunk.moduleIds.some((id) => /node_modules[\\/](@walletconnect|@reown)[\\/]/.test(id)) ? 'assets/wc-[hash].js' : 'assets/[name]-[hash].js',
        // Lazy chunks share these two with the main bundle. In a chunk of their own, a new build of the app doesn't rename every lazy chunk, so phones only download what really changed.
        codeSplitting: { groups: [{ name: 'shared', test: /vite[\\/]preload-helper|[\\/]src[\\/]passwords\.ts$/ }] },
      },
    },
  },
  plugins: [
    react(),
    // `npm run dev:phone` serves HTTPS on the LAN so a phone can test (crypto needs a secure origin).
    ...(mode === 'phone' || process.env.STILL_HTTPS ? [basicSsl()] : []),
    {
      name: 'still-rpc-gateway',
      configureServer(server) {
        // A prod build on this origin may have left an offline SW serving stale code. In dev /sw.js unregisters it.
        server.middlewares.use('/sw.js', (_request, response) => {
          response.setHeader('Content-Type', 'application/javascript')
          response.setHeader('Cache-Control', 'no-store')
          response.end(`self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key)
  await self.registration.unregister()
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
})()))`)
        })
        server.middlewares.use(createGateway())
      },
      configurePreviewServer(server) { server.middlewares.use(createGateway()) },
    },
    {
      name: 'still-production-csp',
      apply: 'build',
      transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/brand.svg'],
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Still Wallet',
        short_name: 'Still Wallet',
        description: 'A privacy-first multi-chain wallet by ow2',
        start_url: '/wallet',
        scope: '/',
        display: 'standalone',
        background_color: '#09090b',
        theme_color: '#09090b',
        icons: [
          { src: '/icons/still-touch-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,png,svg,jpg,woff2,webmanifest,txt}'],
        // The XMR wallet worker (3.7 MB) and WalletConnect load on demand, not on install. Share and touch icons are never shown in the app.
        globIgnores: ['**/monero.worker-*.js', '**/wc-*.js', '**/apple-touch-icon*', 'icons/{apple-touch-icon,still-touch-180,icon-192,icon-512,maskable-512,share-512}.png'],
        // Pages load fresh from the network so every open shows the latest build. Offline (or slow, 3s) falls back to the cached page.
        navigateFallback: null,
        directoryIndex: 'no-directory-index',
        runtimeCaching: [{
          urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
          handler: 'NetworkFirst',
          options: { cacheName: 'pages', networkTimeoutSeconds: 3, precacheFallback: { fallbackURL: '/index.html' } },
        }],
      },
    }),
  ],
}))
