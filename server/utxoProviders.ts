/** Dash (Insight API) and Zcash (Blockchair), answered in the Esplora shape the wallet reads for Bitcoin.
 *  The wallet checks what it can itself: Dash previous transactions against their txid, Zcash amounts are signed (ZIP 244). */

type Reply = { status: number; body: string; type?: string }
const json = (value: unknown): Reply => ({ status: 200, body: JSON.stringify(value) })
const text = (value: string): Reply => ({ status: 200, body: value, type: 'text/plain; charset=utf-8' })
const missing: Reply = { status: 404, body: '{"error":"Not found"}' }
const satoshis = (value: unknown) => {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

function getter(request: typeof fetch, signal: AbortSignal) {
  return async (url: string) => {
    const response = await request(url, { redirect: 'error', signal, headers: { Accept: 'application/json' } })
    if (response.status === 404) { await response.body?.cancel(); return undefined }
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('upstream'), { status: response.status === 429 ? 429 : 502 }) }
    return await response.json() as unknown
  }
}

export async function insightRoute(base: URL, suffix: string, method: string, body: string | undefined, request: typeof fetch, signal: AbortSignal): Promise<Reply> {
  const root = base.href.replace(/\/+$/, '')
  const get = getter(request, signal)
  let match: RegExpExecArray | null
  if (method === 'POST' && suffix === '/tx') {
    const response = await request(`${root}/tx/send`, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: body }) })
    if (!response.ok) { await response.body?.cancel(); return { status: response.status === 429 ? 429 : 400, body: '{"error":"Rejected"}' } }
    const reply = await response.json() as { txid?: unknown }
    return text(typeof reply.txid === 'string' ? reply.txid : '')
  }
  if (method !== 'GET') return { status: 405, body: '{"error":"Method not allowed"}' }
  if (suffix === '/block-height/0') {
    const block = await get(`${root}/block-index/0`) as { blockHash?: unknown } | undefined
    return typeof block?.blockHash === 'string' ? text(block.blockHash) : missing
  }
  if ((match = /^\/address\/([A-Za-z\d]{25,40})$/.exec(suffix))) {
    const data = await get(`${root}/addr/${match[1]}/?noTxList=1`) as { balanceSat?: unknown; unconfirmedBalanceSat?: unknown } | undefined
    const confirmed = satoshis(data?.balanceSat ?? 0)
    const pending = satoshis(data?.unconfirmedBalanceSat ?? 0)
    if (confirmed === undefined || pending === undefined) return { status: 502, body: '{"error":"Bad balance"}' }
    return json({
      chain_stats: { funded_txo_sum: confirmed, spent_txo_sum: 0 },
      mempool_stats: { funded_txo_sum: Math.max(0, pending), spent_txo_sum: Math.max(0, -pending) },
    })
  }
  if ((match = /^\/address\/([A-Za-z\d]{25,40})\/utxo$/.exec(suffix))) {
    const list = await get(`${root}/addr/${match[1]}/utxo`)
    if (!Array.isArray(list)) return json([])
    return json(list.flatMap((coin: { txid?: unknown; vout?: unknown; satoshis?: unknown; confirmations?: unknown; height?: unknown }) => {
      const value = satoshis(coin.satoshis)
      if (typeof coin.txid !== 'string' || typeof coin.vout !== 'number' || !value) return []
      return [{ txid: coin.txid, vout: coin.vout, value, status: { confirmed: Number(coin.confirmations) > 0 || Number(coin.height) > 0 } }]
    }))
  }
  if ((match = /^\/tx\/([a-f\d]{64})\/hex$/.exec(suffix))) {
    const data = await get(`${root}/rawtx/${match[1]}`) as { rawtx?: unknown } | undefined
    return typeof data?.rawtx === 'string' && /^[a-f\d]+$/i.test(data.rawtx) ? text(data.rawtx) : missing
  }
  if ((match = /^\/tx\/([a-f\d]{64})\/status$/.exec(suffix))) {
    const tx = await get(`${root}/tx/${match[1]}`) as { blockheight?: unknown; confirmations?: unknown } | undefined
    if (!tx) return missing
    return json({ confirmed: Number(tx.confirmations) > 0 || Number(tx.blockheight) > 0 })
  }
  return missing
}

const zcashGenesis = '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08'

export async function blockchairRoute(base: URL, suffix: string, method: string, body: string | undefined, request: typeof fetch, signal: AbortSignal, key?: string): Promise<Reply> {
  const root = base.href.replace(/\/+$/, '')
  const get = getter(request, signal)
  const withKey = (url: string) => key ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : url
  let match: RegExpExecArray | null
  if (method === 'POST' && suffix === '/tx') {
    const response = await request(withKey(`${root}/push/transaction`), {
      method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: body ?? '' }).toString(),
    })
    if (!response.ok) { await response.body?.cancel(); return { status: response.status === 429 ? 429 : 400, body: '{"error":"Rejected"}' } }
    const reply = await response.json() as { data?: { transaction_hash?: unknown } }
    return text(typeof reply.data?.transaction_hash === 'string' ? reply.data.transaction_hash : '')
  }
  if (method !== 'GET') return { status: 405, body: '{"error":"Method not allowed"}' }
  // Genesis never changes and Blockchair has no cheap route for it, so a working stats call stands in as the check.
  if (suffix === '/block-height/0' || suffix === '/blocks/tip/height') {
    const stats = await get(withKey(`${root}/stats`)) as { data?: { best_block_height?: unknown } } | undefined
    const height = satoshis(stats?.data?.best_block_height)
    if (!height) return { status: 502, body: '{"error":"Chain provider unavailable"}' }
    return text(suffix === '/block-height/0' ? zcashGenesis : String(height))
  }
  if ((match = /^\/address\/(t[13][A-Za-z\d]{33})(\/utxo)?$/.exec(suffix))) {
    const data = await get(withKey(`${root}/dashboards/address/${match[1]}?limit=0,100`)) as {
      data?: Record<string, { address?: { balance?: unknown; unconfirmed_balance?: unknown }; utxo?: { transaction_hash?: unknown; index?: unknown; value?: unknown; block_id?: unknown }[] }>
    } | undefined
    const entry = data?.data?.[match[1]]
    if (match[2]) {
      return json((entry?.utxo ?? []).flatMap((coin) => {
        const value = satoshis(coin.value)
        if (typeof coin.transaction_hash !== 'string' || typeof coin.index !== 'number' || !value) return []
        return [{ txid: coin.transaction_hash, vout: coin.index, value, status: { confirmed: Number(coin.block_id) > 0 } }]
      }))
    }
    const balance = satoshis(entry?.address?.balance ?? 0)
    if (balance === undefined) return { status: 502, body: '{"error":"Bad balance"}' }
    return json({ chain_stats: { funded_txo_sum: balance, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } })
  }
  if ((match = /^\/tx\/([a-f\d]{64})\/status$/.exec(suffix))) {
    const data = await get(withKey(`${root}/dashboards/transaction/${match[1]}`)) as { data?: Record<string, { transaction?: { block_id?: unknown } }> } | undefined
    const tx = data?.data?.[match[1]]?.transaction
    if (!tx) return missing
    return json({ confirmed: Number(tx.block_id) > 0 })
  }
  return missing
}

/** Kaspa REST (kaspa-rest-server) paths the wallet uses. */
export const kaspaPath = /^\/(?:info\/blockdag|info\/fee-estimate|addresses\/kaspa:[a-z\d]{61,63}\/(?:balance|utxos)|transactions\/[a-f\d]{64})$/
