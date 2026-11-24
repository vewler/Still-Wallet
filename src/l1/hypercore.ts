import { getAddress, isAddress } from 'viem'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { notOwn, rest, sameWallet, type Fetcher } from './common'

/** HYPE on Hyperliquid's own chain (HyperCore). Same address as Ethereum, transfers are signed EIP-712 actions. */
type Balances = { balances?: { coin?: string; total?: string; hold?: string }[] }
type Meta = { tokens?: { name?: string; tokenId?: string; weiDecimals?: number }[] }

const info = <T>(endpoint: string, body: unknown, fetcher: Fetcher) => rest<T>(endpoint, '/info', fetcher, JSON.stringify(body))

function units(text: string | undefined) {
  const [whole, fraction = ''] = (text ?? '0').split('.')
  return BigInt(whole + fraction.padEnd(8, '0').slice(0, 8))
}

async function spot(endpoint: string, owner: string, fetcher: Fetcher) {
  const state = await info<Balances>(endpoint, { type: 'spotClearinghouseState', user: owner.toLowerCase() }, fetcher)
  if (!state || !Array.isArray(state.balances)) throw new Error('Hyperliquid could not load the balance.')
  const entry = state.balances.find((item) => item.coin === 'HYPE')
  return { total: units(entry?.total), held: units(entry?.hold) }
}

export async function checkHypercore(endpoint: string, fetcher: Fetcher) {
  const meta = await info<Meta>(endpoint, { type: 'spotMeta' }, fetcher)
  if (!meta?.tokens?.some((token) => token.name === 'HYPE')) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function hypercoreBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  return (await spot(endpoint, owner, fetcher)).total
}

export async function quoteHypercore(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: Fetcher): Promise<Quote> {
  const text = recipient.trim()
  if (!isAddress(text, { strict: false }) || (text !== text.toLowerCase() && text !== getAddress(text))) throw new Error('Enter a valid Ethereum-format address with the correct checksum.')
  const to = getAddress(text)
  notOwn(getAddress(from), to)
  const value = parseAmount(amount, 8)
  const [balance, meta] = await Promise.all([spot(endpoint, from, fetcher), info<Meta>(endpoint, { type: 'spotMeta' }, fetcher)])
  const token = meta?.tokens?.find((item) => item.name === 'HYPE')
  if (!token?.tokenId || token.weiDecimals !== 8) throw new Error('Hyperliquid transfers are currently unavailable.')
  if (balance.total - balance.held < value) throw new Error('Insufficient HYPE on Hyperliquid to cover this transfer.')
  const display = formatAmount(value, 8)
  const expires = Date.now() + 60_000
  return {
    to, value: display, fee: '0', network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The quote expired. Request another quote.')
      const account = (await import('../vault')).evmAccount(session.mnemonic, session.account)
      sameWallet(getAddress(from), account.address)
      const time = Date.now()
      const action = { type: 'spotSend', signatureChainId: '0x66eee', hyperliquidChain: 'Mainnet', destination: to.toLowerCase(), token: `HYPE:${token.tokenId}`, amount: display, time }
      const signature = await account.signTypedData({
        domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: 421614, verifyingContract: '0x0000000000000000000000000000000000000000' },
        primaryType: 'HyperliquidTransaction:SpotSend',
        types: { 'HyperliquidTransaction:SpotSend': [
          { name: 'hyperliquidChain', type: 'string' }, { name: 'destination', type: 'string' }, { name: 'token', type: 'string' },
          { name: 'amount', type: 'string' }, { name: 'time', type: 'uint64' },
        ] },
        message: { hyperliquidChain: 'Mainnet', destination: action.destination, token: action.token, amount: display, time: BigInt(time) },
      })
      const body = JSON.stringify({ action, nonce: time, signature: { r: signature.slice(0, 66), s: `0x${signature.slice(66, 130)}`, v: parseInt(signature.slice(130, 132), 16) } })
      // HyperCore replies without a hash, Activity finds it later in the ledger.
      return { hash: `hl-${time}`, from, async broadcast() {
        const reply = await rest<{ status?: string; response?: unknown }>(endpoint, '/exchange', fetcher, body)
        if (reply?.status !== 'ok') throw new Error(typeof reply?.response === 'string' ? `Hyperliquid rejected the transfer: ${reply.response}` : 'Hyperliquid submission is unverified.')
      } }
    },
  }
}

type Ledger = { time?: number; hash?: string; delta?: { type?: string; token?: string; amount?: string; destination?: string; user?: string } }[]

export async function hypercoreStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  const sent = Number(item.hash.replace(/^hl-/, ''))
  if (!item.from || !Number.isFinite(sent)) return item.status
  const ledger = await info<Ledger>(endpoint, { type: 'userNonFundingLedgerUpdates', user: item.from.toLowerCase(), startTime: sent - 60_000 }, fetcher)
  const match = ledger?.find((entry) => entry.delta?.type === 'spotTransfer' && entry.delta.token === 'HYPE' && entry.delta.destination?.toLowerCase() === item.to.toLowerCase() &&
    units(entry.delta.amount) === units(item.value))
  if (match) return 'confirmed'
  return item.status
}
