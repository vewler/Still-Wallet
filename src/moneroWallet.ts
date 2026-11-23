import workerUrl from 'monero-ts/dist/monero.worker.js?url'
import { formatAmount, parseAmount, type Network } from './networks'
import { validMoneroAddress } from './monero'
import type { Quote } from './rpc'
import { moneroWallet, type Session } from './vault'

// Nothing sent to a Still wallet can be older than XMR support, so scans start here.
export const launchHeight = 3_812_000
const password = 'still'
const database = 'still-monero'

type Reply = { result?: unknown; error?: { message?: string } }
let worker: Worker | undefined
let calls = 0
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
const wallets = new Map<string, { id: string; endpoint: string; queue: Promise<unknown> }>()

function call<T>(objectId: string, method: string, ...args: unknown[]) {
  if (!worker) {
    worker = new Worker(workerUrl)
    worker.onmessage = ({ data }: MessageEvent<[string, string, Reply]>) => {
      const waiting = pending.get(data[1])
      if (!waiting || !data[2] || typeof data[2] !== 'object') return
      pending.delete(data[1])
      if (data[2].error) waiting.reject(new Error(data[2].error.message || 'Monero wallet error.'))
      else waiting.resolve(data[2].result)
    }
    worker.onerror = () => closeMonero()
  }
  const id = `c${++calls}`
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    worker!.postMessage([objectId, method, id, ...args])
  })
}

/** Locking drops the worker, and the spend key with it. */
export function closeMonero() {
  worker?.terminate()
  worker = undefined
  wallets.clear()
  pending.forEach(({ reject }) => reject(new Error('The Monero wallet closed.')))
  pending.clear()
}

function store<T>(mode: IDBTransactionMode, run: (objects: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open(database, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('wallets')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = run(open.result.transaction('wallets', mode).objectStore('wallets'))
      request.onsuccess = () => { resolve(request.result); open.result.close() }
      request.onerror = () => { reject(request.error); open.result.close() }
    }
  })
}

/** Scan cache, encrypted with the wallet's activity key so nothing readable sits on disk. */
async function loadCache(session: Session) {
  const saved = await store<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined>('readonly', (objects) => objects.get(session.id)).catch(() => undefined)
  if (!saved) return
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: saved.iv }, session.activityKey, saved.data))
    const split = new DataView(plain.buffer).getUint32(0)
    return [plain.slice(4, 4 + split), plain.slice(4 + split)]
  } catch { return }
}

async function saveCache(session: Session, keys: Uint8Array, cache: Uint8Array) {
  const plain = new Uint8Array(4 + keys.length + cache.length)
  new DataView(plain.buffer).setUint32(0, keys.length)
  plain.set(keys, 4)
  plain.set(cache, 4 + keys.length)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.activityKey, plain)
  plain.fill(0)
  await store('readwrite', (objects) => objects.put({ iv, data }, session.id))
}

/** One wallet per session, calls run one at a time. */
function withWallet<T>(session: Session, endpoint: string, run: (id: string) => Promise<T>): Promise<T> {
  let wallet = wallets.get(session.id)
  if (!wallet || wallet.endpoint !== endpoint) {
    const id = crypto.randomUUID()
    const opening = (async () => {
      const server = { uri: endpoint }
      const cached = await loadCache(session)
      if (cached) {
        try { await call(id, 'openWalletData', '', password, 0, cached[0], cached[1], server) } catch { await create(id, session, server) }
      } else await create(id, session, server)
      if (await call<string>(id, 'getAddress', 0, 0) !== session.addresses.monero) throw new Error('The Monero wallet does not match this phrase.')
    })()
    wallet = { id, endpoint, queue: opening }
    wallets.set(session.id, wallet)
  }
  const current = wallet
  const next = current.queue.catch(() => {}).then(() => wallets.get(session.id) === current ? run(current.id) : Promise.reject(new Error('The Monero wallet closed.')))
  current.queue = next
  return next
}

async function create(id: string, session: Session, server: { uri: string }) {
  const keys = await moneroWallet(session.mnemonic, session.account)
  await call(id, 'createWalletFull', { networkType: 0, password, privateSpendKey: keys.spend, primaryAddress: keys.address, restoreHeight: launchHeight, server })
}

async function sync(session: Session, id: string) {
  await call(id, 'sync', undefined, false)
  const [keys, cache] = (await call<DataView[]>(id, 'getData')).map((view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  await saveCache(session, keys, cache).catch(() => {})
}

/** Scans new blocks with the view key on this device, then returns the total balance. */
export function moneroBalance(session: Session, endpoint: string) {
  return withWallet(session, endpoint, async (id) => {
    await sync(session, id)
    return BigInt(await call<string>(id, 'getBalance', undefined, undefined))
  })
}

type TxSet = { txs?: { hash?: string; fee?: string | number; metadata?: string }[] }

export async function quoteMonero(network: Network, endpoint: string, session: Session, recipient: string, amount: string, signal: AbortSignal): Promise<Quote> {
  const to = recipient.trim()
  if (!validMoneroAddress(to)) throw new Error('Enter a valid Monero mainnet address.')
  if (to === session.addresses.monero) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, network.decimals)
  const tx = await withWallet(session, endpoint, async (id) => {
    await sync(session, id)
    const unlocked = BigInt(await call<string>(id, 'getUnlockedBalance', 0, undefined))
    if (unlocked < value) throw new Error(BigInt(await call<string>(id, 'getBalance', 0, undefined)) >= value
      ? 'Some of your XMR is still locked. New funds unlock after 10 blocks, about 20 minutes.'
      : 'Insufficient XMR to cover this transfer.')
    let set: TxSet
    try { set = await call<TxSet>(id, 'createTxs', { accountIndex: 0, destinations: [{ address: to, amount: value.toString() }], relay: false }) }
    catch (problem) { throw new Error(problem instanceof Error && /not enough|insufficient/i.test(problem.message) ? 'Insufficient unlocked XMR to cover the amount and network fee.' : 'The Monero node could not prepare this transfer. Try again.') }
    if (set.txs?.length !== 1) throw new Error('This amount needs more than one transaction. Send a smaller amount.')
    return set.txs[0]
  })
  signal.throwIfAborted()
  if (!tx.hash || !tx.metadata || tx.fee === undefined) throw new Error('The Monero wallet returned an incomplete transaction.')
  const { hash, metadata } = tx
  const expires = Date.now() + 120_000
  return {
    to, value: formatAmount(value, network.decimals), fee: formatAmount(BigInt(tx.fee), network.decimals), network, expires,
    async sign(signer) {
      if (signer.id !== session.id) throw new Error('This quote belongs to a different wallet.')
      if (Date.now() > expires) throw new Error('The Monero quote expired. Request another quote.')
      return {
        hash,
        async broadcast() {
          const sent = await withWallet(session, endpoint, (id) => call<string[]>(id, 'relayTxs', [metadata]))
          if (sent?.[0] !== hash) throw new Error('The node returned an unexpected transaction ID.')
        },
      }
    },
  }
}
