import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname } from 'node:path'
import { createGateway } from './gateway.ts'

const dist = new URL('../dist/', import.meta.url)
if (!(await stat(new URL('index.html', dist)).catch(() => undefined))?.isFile()) {
  throw new Error('Run npm run build before starting Still.')
}
const gateway = createGateway()
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
}

const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()')
  // Only meaningful behind HTTPS (the usual deployment); browsers ignore it on plain HTTP.
  response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  void gateway(request, response, async () => {
    const method = request.method
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const path = (request.url ?? '').split('?')[0]
    if (!/^\/(?:[a-z\d_.-]+\/)*[a-z\d_.-]*$/i.test(path) || path.split('/').some((part) => part.startsWith('.'))) {
      response.writeHead(404).end()
      return
    }
    const file = new URL(path === '/' ? 'index.html' : path.slice(1), dist)
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file.pathname)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (method === 'HEAD') response.end()
    else createReadStream(file).on('error', () => response.destroy()).pipe(response)
  })
})
const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? '0.0.0.0'
server.listen(port, host, () => console.log(`Still listening on ${host}:${port}`))
