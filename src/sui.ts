import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { formatAmount, parseAmount, type Network } from './networks'
import type { ActivityItem } from './storage'
import type { Quote } from './rpc'
import { suiKey } from './vault'

/** Mainnet's chain id (genesis checkpoint digest prefix). */
const mainnet = '35834a8a'
const addressPattern = /^0x[a-f\d]{64}$/i
const digestPattern = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/

/** Sui GraphQL, through the Still gateway by default. */
function suiClient(endpoint: string, fetcher: typeof fetch) {
  return new SuiGraphQLClient({ url: endpoint, network: 'mainnet', fetch: fetcher })
}

export async function checkSui(endpoint: string, fetcher: typeof fetch) {
  const client = suiClient(endpoint, fetcher)
  const { chainIdentifier } = await client.core.getChainIdentifier()
  if (chainIdentifier !== mainnet) throw new Error('The provider is connected to a different Sui network.')
  return client
}

export async function suiBalance(endpoint: string, owner: string, fetcher: typeof fetch) {
  const { balance } = await suiClient(endpoint, fetcher).core.getBalance({ owner })
  return BigInt(balance.balance)
}

export async function quoteSui(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: typeof fetch): Promise<Quote> {
  const to = recipient.trim().toLowerCase()
  if (!addressPattern.test(to)) throw new Error('Enter a valid Sui address (0x and 64 characters).')
  if (to === from) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, network.decimals)
  const client = await checkSui(endpoint, fetcher)
  const { balance } = await client.core.getBalance({ owner: from })
  if (BigInt(balance.balance) < value) throw new Error('Insufficient SUI to cover the amount and network fee.')
  const transaction = new Transaction()
  transaction.setSender(from)
  transaction.transferObjects([coinWithBalance({ balance: value })], to)
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await transaction.build({ client })
  } catch {
    throw new Error('The network rejected this transaction in a test run. Check the amount and balance, then try again.')
  }
  const budget = BigInt(Transaction.from(bytes).getData().gasData.budget ?? 0)
  if (BigInt(balance.balance) < value + budget) throw new Error('Insufficient SUI to cover the amount and network fee.')
  const simulated = await client.core.simulateTransaction({ transaction: bytes, include: { effects: true } })
  const effects = simulated.Transaction?.effects
  if (!effects?.status.success) throw new Error('The network rejected this transaction in a test run. Check the amount and balance, then try again.')
  const gas = effects.gasUsed
  const used = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate)
  const fee = used > 0n ? used : 0n
  const expires = Date.now() + 45_000
  return {
    to, value: formatAmount(value, network.decimals), fee: formatAmount(fee, network.decimals), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const secret = await suiKey(session.mnemonic, session.account)
      try {
        const keypair = Ed25519Keypair.fromSecretKey(secret)
        if (keypair.toSuiAddress() !== from) throw new Error('This quote belongs to a different wallet.')
        const { signature } = await keypair.signTransaction(bytes)
        const hash = await Transaction.from(bytes).getDigest()
        return {
          hash,
          async broadcast() {
            const result = await client.core.executeTransaction({ transaction: bytes, signatures: [signature] })
            const sent = result.Transaction ?? result.FailedTransaction
            if (sent?.digest !== hash) throw new Error('The provider returned an unexpected transaction ID.')
            if (result.FailedTransaction) throw new Error('The Sui network rejected this transaction.')
          },
        }
      } finally {
        secret.fill(0)
      }
    },
  }
}

export async function suiStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!digestPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  let result
  try {
    result = await suiClient(endpoint, fetcher).core.getTransaction({ digest: item.hash, include: { effects: true } })
  } catch {
    return item.status
  }
  if (result.FailedTransaction) return 'failed'
  return result.Transaction?.effects?.status.success === false ? 'failed' : 'confirmed'
}
