import { bech32, hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { base64, concat, notOwn, rest, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'
import { bytesField, messageField, uintField } from './proto'

export const cosmosChains = {
  cosmos: { prefix: 'cosmos', denom: 'uatom', chainId: 'cosmoshub-4', gas: 120_000n, price: [25n, 1000n] },
  celestia: { prefix: 'celestia', denom: 'utia', chainId: 'celestia', gas: 120_000n, price: [20n, 1000n] },
  kava: { prefix: 'kava', denom: 'ukava', chainId: 'kava_2222-10', gas: 150_000n, price: [25n, 1000n] },
  axelar: { prefix: 'axelar', denom: 'uaxl', chainId: 'axelar-dojo-1', gas: 150_000n, price: [8n, 1000n] },
  injective: { prefix: 'inj', denom: 'inj', chainId: 'injective-1', gas: 160_000n, price: [500_000_000n, 1n] },
} as const
export type CosmosChain = keyof typeof cosmosChains
const eth = (chain: CosmosChain) => chain === 'injective'

export function cosmosAddress(chain: CosmosChain, publicKey: Uint8Array) {
  const bytes = eth(chain) ? keccak_256(secp256k1.Point.fromBytes(publicKey).toBytes(false).subarray(1)).subarray(12) : ripemd160(sha256(publicKey))
  return bech32.encode(cosmosChains[chain].prefix, bech32.toWords(bytes))
}

function check(chain: CosmosChain, address: string) {
  try {
    const { prefix, words } = bech32.decode(address.trim() as `${string}1${string}`)
    if (prefix === cosmosChains[chain].prefix && bech32.fromWords(words).length === 20) return address.trim()
  } catch { /* Fall through. */ }
  throw new Error(`Enter a valid address starting with ${cosmosChains[chain].prefix}1.`)
}

const coin = (denom: string, amount: bigint) => concat(bytesField(1, denom), bytesField(2, amount.toString()))
const any = (type: string, value: Uint8Array) => concat(bytesField(1, type), bytesField(2, value))

export function cosmosSignDoc(chain: CosmosChain, fields: { from: string; to: string; amount: bigint; memo: string; publicKey: Uint8Array; sequence: bigint; accountNumber: bigint; fee: bigint }) {
  const { denom, chainId, gas } = cosmosChains[chain]
  const send = concat(bytesField(1, fields.from), bytesField(2, fields.to), messageField(3, coin(denom, fields.amount)))
  const body = concat(messageField(1, any('/cosmos.bank.v1beta1.MsgSend', send)), bytesField(2, fields.memo))
  const keyType = eth(chain) ? '/injective.crypto.v1beta1.ethsecp256k1.PubKey' : '/cosmos.crypto.secp256k1.PubKey'
  const signer = concat(messageField(1, any(keyType, bytesField(1, fields.publicKey))), messageField(2, messageField(1, uintField(1, 1))), uintField(3, fields.sequence))
  const authInfo = concat(messageField(1, signer), messageField(2, concat(messageField(1, coin(denom, fields.fee)), uintField(2, gas))))
  const doc = concat(bytesField(1, body), bytesField(2, authInfo), bytesField(3, chainId), uintField(4, fields.accountNumber))
  return { body, authInfo, doc }
}

export function cosmosSign(chain: CosmosChain, parts: { body: Uint8Array; authInfo: Uint8Array; doc: Uint8Array }, key: Uint8Array) {
  const digest = eth(chain) ? keccak_256(parts.doc) : sha256(parts.doc)
  const signature = secp256k1.sign(digest, key, { prehash: false, lowS: true })
  const raw = concat(bytesField(1, parts.body), bytesField(2, parts.authInfo), bytesField(3, signature))
  return { raw, hash: hex.encode(sha256(raw)).toUpperCase() }
}

type AccountReply = { account?: { account_number?: string; sequence?: string; base_account?: { account_number?: string; sequence?: string } } }

export async function checkCosmos(chain: CosmosChain, endpoint: string, fetcher: Fetcher) {
  const info = await rest<{ default_node_info?: { network?: string } }>(endpoint, '/cosmos/base/tendermint/v1beta1/node_info', fetcher)
  if (info?.default_node_info?.network !== cosmosChains[chain].chainId) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function cosmosBalance(chain: CosmosChain, endpoint: string, owner: string, fetcher: Fetcher) {
  const reply = await rest<{ balance?: { amount?: string } }>(endpoint, `/cosmos/bank/v1beta1/balances/${owner}/by_denom?denom=${cosmosChains[chain].denom}`, fetcher)
  if (!reply?.balance) throw new Error('The network provider could not load the balance.')
  return BigInt(reply.balance.amount ?? '0')
}

export async function quoteCosmos(chain: CosmosChain, network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  const to = check(chain, recipient)
  notOwn(from, to)
  if (utf8(memo).length > 256) throw new Error('Keep the memo under 256 bytes.')
  const value = parseAmount(amount, network.decimals)
  const { gas, price } = cosmosChains[chain]
  const fee = (gas * price[0] + price[1] - 1n) / price[1]
  const [balance, reply] = await Promise.all([cosmosBalance(chain, endpoint, from, fetcher), rest<AccountReply>(endpoint, `/cosmos/auth/v1beta1/accounts/${from}`, fetcher)])
  const account = reply?.account?.base_account ?? reply?.account
  if (!account?.account_number) throw new Error(`Insufficient ${network.symbol}. Receive some first to activate this address.`)
  if (balance < value + fee) throw new Error(`Insufficient ${network.symbol} to cover the amount and network fee.`)
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, network.decimals), fee: formatAmount(fee, network.decimals), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, chain)
      try {
        const publicKey = secp256k1.getPublicKey(key, true)
        sameWallet(from, cosmosAddress(chain, publicKey))
        const parts = cosmosSignDoc(chain, { from, to, amount: value, memo: memo.trim(), publicKey, sequence: BigInt(account.sequence ?? '0'), accountNumber: BigInt(account.account_number!), fee })
        const { raw, hash } = cosmosSign(chain, parts, key)
        return { hash, async broadcast() {
          const reply = await rest<{ tx_response?: { code?: number; txhash?: string; raw_log?: string } }>(endpoint, '/cosmos/tx/v1beta1/txs', fetcher, JSON.stringify({ tx_bytes: base64(raw), mode: 'BROADCAST_MODE_SYNC' }))
          const result = reply?.tx_response
          if (!result || result.code || result.txhash?.toUpperCase() !== hash) throw new Error(result?.raw_log ? `The network rejected the transaction: ${result.raw_log.slice(0, 120)}` : 'Submission is unverified.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function cosmosStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^[A-F\d]{64}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const reply = await rest<{ tx_response?: { code?: number; height?: string } }>(endpoint, `/cosmos/tx/v1beta1/txs/${item.hash}`, fetcher)
  const result = reply?.tx_response
  // Not found long after sending: dropped, or the node doesn't keep a transaction index.
  if (!result?.height || result.height === '0') return Date.now() - item.created > 2 * 60 * 60_000 ? 'unknown' : item.status
  return result.code ? 'failed' : 'confirmed'
}
