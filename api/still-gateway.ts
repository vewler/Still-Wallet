import type { IncomingMessage, ServerResponse } from 'node:http'
import { createGateway } from '../server/gateway.ts'

// Vercel supplies the client address in X-Forwarded-For.
const gateway = createGateway({ ...process.env, STILL_TRUST_PROXY: '1' })

export default function handler(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const route = url.searchParams.get('still_route')
  if (route && /^(?:health|(?:rpc|market)\/[a-z0-9/-]+)$/i.test(route)) url.pathname = `/api/${route}`
  url.searchParams.delete('still_route')
  request.url = url.pathname + (url.pathname.startsWith('/api/market/') ? url.search : '')
  return gateway(request, response, () => response.writeHead(404).end())
}
