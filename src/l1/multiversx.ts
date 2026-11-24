import { bech32, hex } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { base64, concat, notOwn, rest, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'
import { bytesField, uintField } from './proto'

export function multiversxAddress(publicKey: Uint8Array) {
  return bech32.encode('erd', bech32.toWords(publicKey))
}

function decode(address: string) {
  try {
    const { prefix, words } = bech32.decode(address.trim() as `${string}1${string}`)
    const bytes = bech32.fromWords(words)
    if (prefix === 'erd' && bytes.length === 32) return Uint8Array.from(bytes)
  } catch { /* Fall through. */ }
  throw new Error('Enter a valid MultiversX address (erd1…).')
}

type Reply<T> = { data?: T; code?: string; error?: string }

export async function checkMultiversx(endpoint: string, fetcher: Fetcher) {
  const reply = await rest<Reply<{ config?: { erd_chain_id?: string } }>>(endpoint, '/network/config', fetcher)
  if (reply?.data?.config?.erd_chain_id !== '1') throw new Error('The RPC endpoint is connected to a different network.')
}

export async function multiversxBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  const reply = await rest<Reply<{ balance?: string }>>(endpoint, `/address/${owner}/balance`, fetcher)
  if (reply?.code !== 'successful' || reply.data?.balance === undefined) throw new Error('The MultiversX gateway could not load the balance.')
  return BigInt(reply.data.balance)
}

type Fields = { nonce: number; value: bigint; receiver: string; sender: string; gasPrice: number; gasLimit: number; data: Uint8Array }

/** Bytes signed by the wallet: the transaction as JSON in protocol field order. */
export function multiversxSigningBytes(tx: Fields) {
  return utf8(JSON.stringify({ nonce: tx.nonce, value: tx.value.toString(), receiver: tx.receiver, sender: tx.sender, gasPrice: tx.gasPrice, gasLimit: tx.gasLimit, ...(tx.data.length ? { data: base64(tx.data) } : {}), chainID: '1', version: 2 }))
}

/** Transaction hash: blake2b-256 of the protobuf form, as mx-chain-go computes it. */
export function multiversxHash(tx: Fields, signature: Uint8Array) {
  const value = tx.value === 0n ? Uint8Array.of(0, 0) : concat([0], hex.decode(tx.value.toString(16).padStart(Math.ceil(tx.value.toString(16).length / 2) * 2, '0')))
  const proto = concat(uintField(1, tx.nonce), bytesField(2, value), bytesField(3, decode(tx.receiver)), bytesField(5, decode(tx.sender)),
    uintField(7, tx.gasPrice), uintField(8, tx.gasLimit), bytesField(9, tx.data), bytesField(10, '1'), uintField(11, 2), bytesField(12, signature))
  return hex.encode(blake2b(proto, { dkLen: 32 }))
}

export async function quoteMultiversx(network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  decode(recipient)
  const to = recipient.trim()
  notOwn(from, to)
  const value = parseAmount(amount, 18)
  const data = utf8(memo.trim())
  if (data.length > 200) throw new Error('Keep the memo under 200 bytes.')
  const [config, account] = await Promise.all([
    rest<Reply<{ config?: { erd_min_gas_price?: number; erd_min_gas_limit?: number; erd_gas_per_data_byte?: number } }>>(endpoint, '/network/config', fetcher),
    rest<Reply<{ account?: { nonce?: number; balance?: string } }>>(endpoint, `/address/${from}`, fetcher),
  ])
  const settings = config?.data?.config
  if (!settings?.erd_min_gas_price || !account?.data?.account) throw new Error('MultiversX network fees are currently unavailable.')
  const gasPrice = settings.erd_min_gas_price
  const gasLimit = (settings.erd_min_gas_limit ?? 50_000) + (settings.erd_gas_per_data_byte ?? 1_500) * data.length
  const fee = BigInt(gasPrice) * BigInt(gasLimit)
  if (BigInt(account.data.account.balance ?? '0') < value + fee) throw new Error('Insufficient EGLD to cover the amount and network fee.')
  const tx: Fields = { nonce: account.data.account.nonce ?? 0, value, receiver: to, sender: from, gasPrice, gasLimit, data }
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 18), fee: formatAmount(fee, 18), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'multiversx')
      try {
        sameWallet(from, multiversxAddress(ed25519.getPublicKey(key)))
        const signature = ed25519.sign(multiversxSigningBytes(tx), key)
        const hash = multiversxHash(tx, signature)
        const body = JSON.stringify({ nonce: tx.nonce, value: value.toString(), receiver: to, sender: from, gasPrice, gasLimit, ...(data.length ? { data: base64(data) } : {}), chainID: '1', version: 2, signature: hex.encode(signature) })
        return { hash, async broadcast() {
          const reply = await rest<Reply<{ txHash?: string }>>(endpoint, '/transaction/send', fetcher, body)
          if (reply?.data?.txHash !== hash) throw new Error(reply?.error ? `MultiversX rejected the transaction: ${reply.error}` : 'MultiversX submission is unverified.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function multiversxStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^[a-f\d]{64}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const reply = await rest<Reply<{ status?: string }>>(endpoint, `/transaction/${item.hash}/status`, fetcher)
  const status = reply?.data?.status
  if (status === 'success') return 'confirmed'
  if (status === 'fail' || status === 'invalid') return 'failed'
  return item.status
}
