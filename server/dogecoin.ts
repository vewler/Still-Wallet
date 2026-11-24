/** Dogecoin through BitPay's Bitcore API, answered in the Esplora shape the wallet reads for Bitcoin and Litecoin.
 *  Bitcore has no raw transaction route, so previous transactions come from BlockCypher or Blockchair. The wallet
 *  checks each one against its txid before signing. */
const rawSources: [url: (id: string) => string, pick: (data: unknown, id: string) => unknown][] = [
  [(id) => `https://api.blockcypher.com/v1/doge/main/txs/${id}?includeHex=true&limit=1`, (data) => (data as { hex?: unknown } | undefined)?.hex],
  [(id) => `https://api.blockchair.com/dogecoin/raw/transaction/${id}`, (data, id) => (data as { data?: Record<string, { raw_transaction?: unknown }> } | undefined)?.data?.[id]?.raw_transaction],
]

type Reply = { status: number; body: string; type?: string }
const json = (value: unknown): Reply => ({ status: 200, body: JSON.stringify(value) })

export async function dogecoinRoute(base: URL, suffix: string, method: string, body: string | undefined, request: typeof fetch, signal: AbortSignal): Promise<Reply> {
  const root = base.href.replace(/\/+$/, '')
  const get = async (url: string) => {
    const response = await request(url, { redirect: 'error', signal, headers: { Accept: 'application/json' } })
    if (response.status === 404) { await response.body?.cancel(); return undefined }
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('upstream'), { status: response.status === 429 ? 429 : 502 }) }
    return await response.json() as unknown
  }
  const missing: Reply = { status: 404, body: '{"error":"Not found"}' }
  let match: RegExpExecArray | null
  if (method === 'POST' && suffix === '/tx') {
    const response = await request(`${root}/tx/send`, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawTx: body }) })
    if (!response.ok) { await response.body?.cancel(); return { status: response.status === 429 ? 429 : 400, body: '{"error":"Rejected"}' } }
    const reply = await response.json() as { txid?: unknown }
    return { status: 200, body: typeof reply.txid === 'string' ? reply.txid : '', type: 'text/plain; charset=utf-8' }
  }
  if (method !== 'GET') return { status: 405, body: '{"error":"Method not allowed"}' }
  if (suffix === '/block-height/0') {
    const block = await get(`${root}/block/0`) as { hash?: unknown } | undefined
    return typeof block?.hash === 'string' ? { status: 200, body: block.hash, type: 'text/plain; charset=utf-8' } : missing
  }
  if ((match = /^\/address\/([A-Za-z\d]{25,60})$/.exec(suffix))) {
    const balance = await get(`${root}/address/${match[1]}/balance`) as { confirmed?: unknown; unconfirmed?: unknown } | undefined
    const confirmed = Number(balance?.confirmed ?? 0)
    const pending = Number(balance?.unconfirmed ?? 0)
    if (!Number.isSafeInteger(confirmed) || !Number.isSafeInteger(pending)) return { status: 502, body: '{"error":"Bad balance"}' }
    return json({
      chain_stats: { funded_txo_sum: confirmed, spent_txo_sum: 0 },
      mempool_stats: { funded_txo_sum: Math.max(0, pending), spent_txo_sum: Math.max(0, -pending) },
    })
  }
  if ((match = /^\/address\/([A-Za-z\d]{25,60})\/utxo$/.exec(suffix))) {
    const list = await get(`${root}/address/${match[1]}/?unspent=true&limit=200`)
    if (!Array.isArray(list)) return json([])
    return json(list.flatMap((coin: { mintTxid?: unknown; mintIndex?: unknown; value?: unknown; mintHeight?: unknown; coinbase?: unknown; confirmations?: unknown }) => {
      if (typeof coin.mintTxid !== 'string' || typeof coin.mintIndex !== 'number' || typeof coin.value !== 'number') return []
      // Coinbase coins can't be spent for 240 blocks.
      const mature = !coin.coinbase || Number(coin.confirmations) >= 240
      return [{ txid: coin.mintTxid, vout: coin.mintIndex, value: coin.value, status: { confirmed: Number(coin.mintHeight) > 0 && mature } }]
    }))
  }
  if ((match = /^\/tx\/([a-f\d]{64})\/hex$/.exec(suffix))) {
    for (const [url, pick] of rawSources) {
      const raw = await get(url(match[1])).then((data) => pick(data, match![1]), () => undefined)
      if (typeof raw === 'string' && /^[a-f\d]+$/i.test(raw)) return { status: 200, body: raw, type: 'text/plain; charset=utf-8' }
    }
    return { status: 502, body: '{"error":"Chain provider unavailable"}' }
  }
  if ((match = /^\/tx\/([a-f\d]{64})\/status$/.exec(suffix))) {
    const tx = await get(`${root}/tx/${match[1]}`) as { blockHeight?: unknown } | undefined
    if (!tx) return missing
    return json({ confirmed: Number(tx.blockHeight) > 0 })
  }
  return missing
}
