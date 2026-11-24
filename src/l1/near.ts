import { base58, base64 as b64, hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { concat, notOwn, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'

/** Implicit account: the hex public key. */
export function nearAddress(publicKey: Uint8Array) {
  return hex.encode(publicKey)
}

const accountPattern = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/
const storagePrice = 10n ** 19n // yoctoNEAR per byte

async function nearRpc<T>(endpoint: string, method: string, params: unknown, fetcher: Fetcher) {
  const response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'still', method, params }) })
  if (!response.ok) throw new Error('The NEAR RPC returned an unsuccessful response.')
  const data = await response.json() as { result?: T; error?: { cause?: { name?: string }; name?: string; data?: unknown } }
  return data
}

type ViewAccount = { amount?: string; locked?: string; storage_usage?: number }

async function viewAccount(endpoint: string, accountId: string, fetcher: Fetcher) {
  const reply = await nearRpc<ViewAccount>(endpoint, 'query', { request_type: 'view_account', finality: 'final', account_id: accountId }, fetcher)
  if (reply.error?.cause?.name === 'UNKNOWN_ACCOUNT') return undefined
  if (!reply.result?.amount) throw new Error('The NEAR RPC could not load the account.')
  return reply.result
}

export async function checkNear(endpoint: string, fetcher: Fetcher) {
  const reply = await nearRpc<{ chain_id?: string }>(endpoint, 'status', [], fetcher)
  if (reply.result?.chain_id !== 'mainnet') throw new Error('The RPC endpoint is connected to a different network.')
}

export async function nearBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  return BigInt((await viewAccount(endpoint, owner, fetcher))?.amount ?? '0')
}

const u32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out }
const u64 = (value: bigint) => { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return out }
const u128 = (value: bigint) => concat(u64(value & (2n ** 64n - 1n)), u64(value >> 64n))
const text = (value: string) => { const bytes = utf8(value); return concat(u32(bytes.length), bytes) }

/** Borsh Transaction with one Transfer action. */
export function nearTransaction(signer: string, publicKey: Uint8Array, nonce: bigint, receiver: string, blockHash: Uint8Array, deposit: bigint) {
  return concat(text(signer), [0], publicKey, u64(nonce), text(receiver), blockHash, u32(1), [3], u128(deposit))
}

export async function quoteNear(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: Fetcher): Promise<Quote> {
  const to = recipient.trim().toLowerCase()
  if (!accountPattern.test(to) || to.length < 2) throw new Error('Enter a valid NEAR account (name.near or a 64-character implicit account).')
  notOwn(from, to)
  const implicit = /^[a-f\d]{64}$/.test(to) || /^0x[a-f\d]{40}$/.test(to)
  const value = parseAmount(amount, 24)
  const publicKey = hex.decode(from)
  const [account, target, key, price] = await Promise.all([
    viewAccount(endpoint, from, fetcher),
    implicit ? Promise.resolve(undefined) : viewAccount(endpoint, to, fetcher),
    nearRpc<{ nonce?: number | string; block_hash?: string }>(endpoint, 'query', { request_type: 'view_access_key', finality: 'final', account_id: from, public_key: `ed25519:${base58.encode(publicKey)}` }, fetcher),
    nearRpc<{ gas_price?: string }>(endpoint, 'gas_price', [null], fetcher),
  ])
  if (!implicit && !target) throw new Error('This NEAR account doesn’t exist. Check the name.')
  if (!account || key.result?.nonce === undefined || !key.result.block_hash) throw new Error('Insufficient NEAR. Receive some NEAR first to activate this account.')
  // A transfer (with account creation for new implicit accounts) burns under 1 Tgas.
  const fee = BigInt(price.result?.gas_price ?? '100000000') * 10n ** 12n
  const locked = BigInt(account.storage_usage ?? 0) * storagePrice
  if (BigInt(account.amount ?? '0') < value + fee + locked) throw new Error(`Insufficient NEAR. ${formatAmount(locked, 24)} NEAR stays locked for account storage.`)
  const transaction = nearTransaction(from, publicKey, BigInt(key.result.nonce) + 1n, to, base58.decode(key.result.block_hash), value)
  const hash = sha256(transaction)
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 24), fee: formatAmount(fee, 24), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const secret = await l1PrivateKey(session.mnemonic, session.account, 'near')
      try {
        sameWallet(from, nearAddress(ed25519.getPublicKey(secret)))
        const signed = b64.encode(concat(transaction, [0], ed25519.sign(hash, secret)))
        const id = base58.encode(hash)
        return { hash: id, from, async broadcast() {
          const reply = await nearRpc<string>(endpoint, 'broadcast_tx_async', [signed], fetcher)
          if (reply.result !== id) throw new Error('NEAR submission is unverified.')
        } }
      } finally { secret.fill(0) }
    },
  }
}

export async function nearStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!item.from) return item.status
  const reply = await nearRpc<{ status?: { SuccessValue?: string; Failure?: unknown }; final_execution_status?: string }>(endpoint, 'tx', { tx_hash: item.hash, sender_account_id: item.from, wait_until: 'NONE' }, fetcher)
  const status = reply.result?.status
  if (status && 'Failure' in status) return 'failed'
  if (status && 'SuccessValue' in status) return 'confirmed'
  return item.status
}
