import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { createGateway } from './server/gateway.ts'

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig(({ mode }) => ({
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')) },
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
        start_url: '/',
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
        // The XMR wallet worker (3.7 MB) loads on demand, not on install.
        globIgnores: ['**/monero.worker-*.js', '**/apple-touch-icon*', 'icons/{apple-touch-icon,still-touch-180,icon-192,icon-512,maskable-512}.png'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
}))
