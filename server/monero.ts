// Monero daemon proxy. Streams the reply so big block batches don't sit in memory.
// Served from the site root: the wallet's WASM HTTP client drops any path in the daemon URL.
const paths = new Set([
  '/json_rpc', '/get_height', '/getheight', '/get_info', '/getinfo', '/get_transactions', '/gettransactions',
  '/send_raw_transaction', '/sendrawtransaction', '/is_key_image_spent', '/get_transaction_pool_hashes',
  '/getblocks.bin', '/get_blocks.bin', '/getblocks_by_height.bin', '/get_blocks_by_height.bin', '/gethashes.bin', '/get_hashes.bin',
  '/get_o_indexes.bin', '/get_outs.bin', '/get_output_distribution.bin', '/get_transaction_pool_hashes.bin',
])
const jsonMethods = new Set([
  'get_info', 'get_version', 'hard_fork_info', 'get_fee_estimate', 'get_output_distribution', 'get_block_count', 'get_last_block_header',
  'get_block_header_by_height', 'get_block_header_by_hash', 'get_block_headers_range', 'get_block', 'get_txpool_backlog',
])
export const isMoneroPath = (path: string) => paths.has(path)
const requestLimit = 1024 * 1024

export function moneroUpstream(env: Record<string, string | undefined>, fallback: string) {
  const url = new URL(env.STILL_RPC_MONERO || fallback)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid server RPC URL for Monero. Use an HTTPS URL.')
  return url
}

export async function moneroProxy(request: Request, upstream: URL, fetchUpstream: typeof fetch = fetch): Promise<Response> {
  const reject = (status: number) => new Response(JSON.stringify({ error: status >= 500 ? 'Chain provider unavailable' : 'RPC request rejected' }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
  const url = new URL(request.url)
  const path = url.pathname
  const origin = request.headers.get('origin')
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== url.origin)) return reject(403)
  if (!paths.has(path) || url.search || !['GET', 'POST'].includes(request.method)) return reject(404)
  let body: ArrayBuffer | undefined
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length')) > requestLimit) return reject(413)
    body = await request.arrayBuffer()
    if (body.byteLength > requestLimit) return reject(413)
    if (path === '/json_rpc') {
      let payload
      try { payload = JSON.parse(new TextDecoder().decode(body)) } catch { return reject(400) }
      if (!payload || Array.isArray(payload) || !jsonMethods.has(payload.method)) return reject(400)
    }
  }
  const target = new URL(upstream)
  target.pathname = target.pathname.replace(/\/+$/, '') + path
  let reply: Response
  try {
    reply = await fetchUpstream(target, {
      method: request.method, body, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': path.endsWith('.bin') ? 'application/octet-stream' : 'application/json' },
    })
  } catch { return reject(502) }
  if (!reply.ok) { await reply.body?.cancel(); return reject(reply.status === 429 ? 429 : 502) }
  return new Response(reply.body, {
    headers: { 'Content-Type': path.endsWith('.bin') ? 'application/octet-stream' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
