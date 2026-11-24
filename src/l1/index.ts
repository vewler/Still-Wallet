import type { Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import type { Fetcher } from './common'
import { l1PublicKeys, type L1Chain } from './keys'
import { algorandAddress, algorandBalance, algorandStatus, checkAlgorand, quoteAlgorand } from './algorand'
import { checkCosmos, cosmosAddress, cosmosBalance, cosmosChains, cosmosStatus, quoteCosmos, type CosmosChain } from './cosmos'
import { checkMultiversx, multiversxAddress, multiversxBalance, multiversxStatus, quoteMultiversx } from './multiversx'
import { checkNear, nearAddress, nearBalance, nearStatus, quoteNear } from './near'
import { cardanoAddress, cardanoBalance, cardanoStatus, checkCardano, quoteCardano } from './cardano'
import { checkHypercore, hypercoreBalance, hypercoreStatus, quoteHypercore } from './hypercore'
import { checkTon, quoteTon, tonAddress, tonBalance, tonStatus } from './ton'
import { checkTezos, quoteTezos, tezosAddress, tezosBalance, tezosStatus } from './tezos'
import { checkFilecoin, filecoinAddress, filecoinBalance, filecoinStatus, quoteFilecoin } from './filecoin'
import { checkStacks, quoteStacks, stacksAddress, stacksBalance, stacksStatus } from './stacks'
import { checkStellar, quoteStellar, stellarAddress, stellarBalance, stellarStatus } from './stellar'

export type L1Addresses = Record<L1Chain | 'cardano', string>
const isCosmos = (chain: string): chain is CosmosChain => Object.hasOwn(cosmosChains, chain)

/** Addresses for every chain in this folder, from one seed. */
export async function l1Addresses(phrase: string, account: number): Promise<L1Addresses> {
  const keys = await l1PublicKeys(phrase, account)
  return {
    cardano: cardanoAddress(phrase, account), ton: tonAddress(keys.ton), tezos: tezosAddress(keys.tezos), filecoin: filecoinAddress(keys.filecoin), stacks: stacksAddress(keys.stacks),
    stellar: stellarAddress(keys.stellar), near: nearAddress(keys.near), multiversx: multiversxAddress(keys.multiversx), algorand: algorandAddress(keys.algorand),
    cosmos: cosmosAddress('cosmos', keys.cosmos), celestia: cosmosAddress('celestia', keys.celestia), kava: cosmosAddress('kava', keys.kava),
    axelar: cosmosAddress('axelar', keys.axelar), injective: cosmosAddress('injective', keys.injective),
  }
}

export async function l1Check(network: Network, endpoint: string, fetcher: Fetcher) {
  const chain = network.chain
  if (chain === 'hypercore') return checkHypercore(endpoint, fetcher)
  if (chain === 'stacks') return checkStacks(endpoint, fetcher)
  if (chain === 'filecoin') return checkFilecoin(endpoint, fetcher)
  if (chain === 'tezos') return checkTezos(endpoint, fetcher)
  if (chain === 'ton') return checkTon(endpoint, fetcher)
  if (chain === 'cardano') return checkCardano(endpoint, fetcher)
  if (chain === 'stellar') return checkStellar(endpoint, fetcher)
  if (chain === 'near') return checkNear(endpoint, fetcher)
  if (chain === 'multiversx') return checkMultiversx(endpoint, fetcher)
  if (chain === 'algorand') return checkAlgorand(endpoint, fetcher)
  if (isCosmos(chain)) return checkCosmos(chain, endpoint, fetcher)
  throw new Error('Unsupported network.')
}

export async function l1Balance(network: Network, endpoint: string, owner: string, fetcher: Fetcher) {
  const chain = network.chain
  if (chain === 'hypercore') return hypercoreBalance(endpoint, owner, fetcher)
  if (chain === 'stacks') return stacksBalance(endpoint, owner, fetcher)
  if (chain === 'filecoin') return filecoinBalance(endpoint, owner, fetcher)
  if (chain === 'tezos') return tezosBalance(endpoint, owner, fetcher)
  if (chain === 'ton') return tonBalance(endpoint, owner, fetcher)
  if (chain === 'cardano') return cardanoBalance(endpoint, owner, fetcher)
  if (chain === 'stellar') return stellarBalance(endpoint, owner, fetcher)
  if (chain === 'near') return nearBalance(endpoint, owner, fetcher)
  if (chain === 'multiversx') return multiversxBalance(endpoint, owner, fetcher)
  if (chain === 'algorand') return algorandBalance(endpoint, owner, fetcher)
  if (isCosmos(chain)) return cosmosBalance(chain, endpoint, owner, fetcher)
  throw new Error('Unsupported network.')
}

export async function l1Quote(network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  const chain = network.chain
  if (chain === 'hypercore') {
    if (memo.trim()) throw new Error('Hyperliquid transfers don’t carry a memo.')
    return quoteHypercore(network, endpoint, from, recipient, amount, fetcher)
  }
  if (chain === 'stacks') return quoteStacks(network, endpoint, from, recipient, amount, memo, fetcher)
  if (chain === 'filecoin') {
    if (memo.trim()) throw new Error('Filecoin transfers don’t carry a memo.')
    return quoteFilecoin(network, endpoint, from, recipient, amount, fetcher)
  }
  if (chain === 'tezos') {
    if (memo.trim()) throw new Error('Tezos transfers don’t carry a memo.')
    return quoteTezos(network, endpoint, from, recipient, amount, fetcher)
  }
  if (chain === 'ton') return quoteTon(network, endpoint, from, recipient, amount, memo, fetcher)
  if (chain === 'cardano') {
    if (memo.trim()) throw new Error('Cardano transfers from Still don’t carry a memo.')
    return quoteCardano(network, endpoint, from, recipient, amount, fetcher)
  }
  if (chain === 'stellar') return quoteStellar(network, endpoint, from, recipient, amount, memo, fetcher)
  if (chain === 'near') {
    if (memo.trim()) throw new Error('NEAR transfers from Still don’t carry a memo.')
    return quoteNear(network, endpoint, from, recipient, amount, fetcher)
  }
  if (chain === 'multiversx') return quoteMultiversx(network, endpoint, from, recipient, amount, memo, fetcher)
  if (chain === 'algorand') return quoteAlgorand(network, endpoint, from, recipient, amount, memo, fetcher)
  if (isCosmos(chain)) return quoteCosmos(chain, network, endpoint, from, recipient, amount, memo, fetcher)
  throw new Error('Unsupported network.')
}

export async function l1Status(item: ActivityItem, network: Network, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  const chain = network.chain
  if (chain === 'hypercore') return hypercoreStatus(item, endpoint, fetcher)
  if (chain === 'stacks') return stacksStatus(item, endpoint, fetcher)
  if (chain === 'filecoin') return filecoinStatus(item, endpoint, fetcher)
  if (chain === 'tezos') return tezosStatus(item, endpoint, fetcher)
  if (chain === 'ton') return tonStatus(item, endpoint, fetcher)
  if (chain === 'cardano') return cardanoStatus(item, endpoint, fetcher)
  if (chain === 'stellar') return stellarStatus(item, endpoint, fetcher)
  if (chain === 'near') return nearStatus(item, endpoint, fetcher)
  if (chain === 'multiversx') return multiversxStatus(item, endpoint, fetcher)
  if (chain === 'algorand') return algorandStatus(item, endpoint, fetcher)
  if (isCosmos(chain)) return cosmosStatus(item, endpoint, fetcher)
  throw new Error('Unsupported network.')
}
