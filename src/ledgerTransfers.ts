import { hex } from '@scure/base'
import { sha512 } from '@noble/hashes/sha2.js'
import { Address, NETWORK, OutScript, p2pkh, p2wpkh, selectUTXO } from '@scure/btc-signer'
import type { HDKey } from '@scure/bip32'
import { encode, encodeForSigning } from 'ripple-binary-codec'
import { isValidClassicAddress, isValidXAddress, xAddressToClassicAddress } from 'ripple-address-codec'
import { sign } from 'ripple-keypairs'
import { bitcoinCashKey, bitcoinKey, dashKey, dogecoinKey, litecoinKey, xrpKey, zcashKey } from './keys'
import { formatAmount, parseAmount, type Network } from './networks'
import type { ActivityItem } from './storage'
import type { Quote } from './rpc'

const hashPattern = /^[a-f\d]{64}$/i
const xrpLedgerWindow = 10

type UtxoChain = 'bitcoin' | 'litecoin' | 'dogecoin' | 'dash' | 'bitcoincash' | 'zcash'
type UtxoParams = {
  name: string
  symbol: string
  genesis: string
  network: { bech32: string; pubKeyHash: number; scriptHash: number; wif: number }
  /** Native SegWit (wpkh) or legacy (pkh, Dogecoin). */
  kind: 'wpkh' | 'pkh'
  key: (phrase: string, account: number) => Promise<HDKey>
  /** Smallest amount to send, also the change dust limit, in base units. */
  dust: bigint
  /** Fee rate bounds in base units per byte. */
  minFee: number
  maxFee: number
  /** Fixed rate when the provider has no useful estimate (Dogecoin: 0.01 DOGE/kB). */
  fixedFee?: number
}

const utxoParams: Record<UtxoChain, UtxoParams> = {
  bitcoin: {
    name: 'Bitcoin', symbol: 'BTC', genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    network: NETWORK, kind: 'wpkh', key: bitcoinKey, dust: 546n, minFee: 1, maxFee: 2_000,
  },
  litecoin: {
    name: 'Litecoin', symbol: 'LTC', genesis: '12a765e31ffd4059bada1e25190f6e98c99d9714d334efa41a195a7e7e04bfe2',
    network: { bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }, kind: 'wpkh', key: litecoinKey, dust: 546n, minFee: 2, maxFee: 2_000,
  },
  dogecoin: {
    name: 'Dogecoin', symbol: 'DOGE', genesis: '1a91e3dace36e2be3bf030a65679fe821aa1d6ef92e7c9902eb318182c355691',
    network: { bech32: 'doge', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }, kind: 'pkh', key: dogecoinKey, dust: 1_000_000n, minFee: 1_000, maxFee: 100_000, fixedFee: 1_000,
  },
  dash: {
    name: 'Dash', symbol: 'DASH', genesis: '00000ffd590b1485b3caadc19b22e6379c733355108f107a430458cdf3407ab6',
    network: { bech32: 'dash', pubKeyHash: 0x4c, scriptHash: 0x10, wif: 0xcc }, kind: 'pkh', key: dashKey, dust: 10_000n, minFee: 1, maxFee: 1_000, fixedFee: 2,
  },
  // Signed in forkTransfers.ts, listed here for the network check.
  bitcoincash: {
    name: 'Bitcoin Cash', symbol: 'BCH', genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    network: { bech32: 'bitcoincash', pubKeyHash: 0, scriptHash: 5, wif: 0x80 }, kind: 'pkh', key: bitcoinCashKey, dust: 546n, minFee: 1, maxFee: 1, fixedFee: 1,
  },
  zcash: {
    name: 'Zcash', symbol: 'ZEC', genesis: '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08',
    network: { bech32: 'zcash', pubKeyHash: 0x1cb8, scriptHash: 0x1cbd, wif: 0x80 }, kind: 'pkh', key: zcashKey, dust: 5_460n, minFee: 1, maxFee: 1, fixedFee: 1,
  },
}

function utxoFor(network: Network) {
  if (!Object.hasOwn(utxoParams, network.chain)) throw new Error('Unsupported network.')
  return utxoParams[network.chain as UtxoChain]
}

function bitcoinApi(endpoint: string, path: string, fetcher: typeof fetch, options?: RequestInit) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/+$/, '') + path
  return fetcher(url, options)
}

async function bitcoinRead(endpoint: string, path: string, fetcher: typeof fetch, name = 'Bitcoin') {
  const result = await bitcoinApi(endpoint, path, fetcher)
  if (!result.ok) throw new Error(`The ${name} provider could not load transaction data.`)
  return result
}

/** Checks the provider's genesis block. `network` defaults to Bitcoin for older callers. */
export async function checkBitcoinNetwork(endpoint: string, fetcher: typeof fetch, network?: Network) {
  const params = network ? utxoFor(network) : utxoParams.bitcoin
  const result = await bitcoinRead(endpoint, '/block-height/0', fetcher, params.name)
  if ((await result.text()).trim() !== params.genesis) throw new Error(`The provider is connected to a different ${params.name} network.`)
}

/** Esplora fee estimates, or mempool.space-style recommended fees (litecoinspace has only those). */
async function feeRate(endpoint: string, params: UtxoParams, fetcher: typeof fetch) {
  if (params.fixedFee) return params.fixedFee
  let rate: number | undefined
  const estimates = await bitcoinApi(endpoint, '/fee-estimates', fetcher)
  if (estimates.ok) {
    const data = await estimates.json() as Record<string, number>
    rate = data['3'] ?? data['6'] ?? data['2']
  } else {
    await estimates.body?.cancel()
    const data = await (await bitcoinRead(endpoint, '/v1/fees/recommended', fetcher, params.name)).json() as { halfHourFee?: number }
    rate = data.halfHourFee
  }
  const value = Math.max(params.minFee, Math.ceil(Number(rate)))
  if (!Number.isSafeInteger(value) || value > params.maxFee) throw new Error(`${params.name} network fees are currently unavailable.`)
  return value
}

type Utxo = { txid: string; vout: number; value: number; status?: { confirmed?: boolean } }

export async function quoteBitcoin(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: typeof fetch): Promise<Quote> {
  if (network.chain === 'bitcoincash' || network.chain === 'zcash') {
    await checkBitcoinNetwork(endpoint, fetcher, network)
    return (await import('./forkTransfers')).quoteFork(network, endpoint, from, recipient, amount, fetcher)
  }
  const params = utxoFor(network)
  const { name, symbol } = params
  const to = recipient.trim()
  try { Address(params.network).decode(to) } catch { throw new Error(`Enter a valid ${name} mainnet address.`) }
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, 8)
  if (value < params.dust || value > 10n ** 20n) throw new Error(`Enter at least ${formatAmount(params.dust, 8)} ${symbol}.`)
  await checkBitcoinNetwork(endpoint, fetcher, network)
  const [unspent, rate] = await Promise.all([
    bitcoinRead(endpoint, `/address/${from}/utxo`, fetcher, name).then((result) => result.json() as Promise<Utxo[]>),
    feeRate(endpoint, params, fetcher),
  ])
  const spend = ownScript(from, params)
  const seen = new Set<string>()
  const candidates = unspent.filter((utxo) => {
    const outpoint = `${utxo.txid}:${utxo.vout}`.toLowerCase()
    if (!utxo.status?.confirmed || !hashPattern.test(utxo.txid) || !Number.isInteger(utxo.vout) ||
      utxo.vout < 0 || utxo.vout > 0xffff_ffff || !Number.isSafeInteger(utxo.value) ||
      utxo.value <= 0 || seen.has(outpoint)) return false
    seen.add(outpoint)
    return true
  }).sort((a, b) => b.value - a.value)
  // Max 24 confirmed inputs per quote. Fragmented balances would need consolidation.
  const options = candidates.slice(0, 24).map(({ txid, vout, value }) => ({
    txid, index: vout, witnessUtxo: { script: spend, amount: BigInt(value) },
  }))
  if (!options.length) throw new Error(`There is no confirmed ${symbol} to spend from this address.`)
  // Legacy inputs pick by amount first, the full previous transaction is checked below before signing.
  const selected = selectUTXO(options, [{ address: to, amount: value }], 'default', {
    feePerByte: BigInt(rate), changeAddress: from, network: params.network, dust: params.dust, dustRelayFeeRate: 1n,
    allowLegacyWitnessUtxo: params.kind === 'pkh', strictPrevoutValidation: true,
  })
  if (!selected?.tx) throw new Error(`Insufficient confirmed ${symbol} in the available inputs to cover this amount and fee.`)
  const { tx } = selected
  // The previous transactions prove every input amount (their txid is what gets signed), so a provider can't hide a fee.
  const step = params.kind === 'pkh' ? 1 : 6
  for (let start = 0; start < tx.inputsLength; start += step) {
    await Promise.all(Array.from({ length: Math.min(step, tx.inputsLength - start) }, async (_, offset) => {
      const index = start + offset
      const input = tx.getInput(index)
      const result = await bitcoinRead(endpoint, `/tx/${hex.encode(input.txid!)}/hex`, fetcher, name)
      tx.updateInput(index, { nonWitnessUtxo: hex.decode((await result.text()).trim()) })
    }))
  }
  const fee = tx.fee
  const expires = Date.now() + 45_000
  return {
    to, value: formatAmount(value, 8), fee: formatAmount(fee, 8), network, expires,
    async sign(session) {
      const key = await params.key(session.mnemonic, session.account)
      try {
        const own = params.kind === 'pkh' ? p2pkh(key.publicKey!, params.network) : p2wpkh(key.publicKey!, params.network)
        if (own.address !== from) throw new Error('This quote belongs to a different wallet.')
        tx.sign(key.privateKey!)
        tx.finalize()
      } finally {
        key.wipePrivateData()
      }
      const hash = tx.id
      const raw = tx.hex
      return { hash, async broadcast() {
        const result = await bitcoinApi(endpoint, '/tx', fetcher, { method: 'POST', body: raw, headers: { 'Content-Type': 'text/plain' } })
        if (!result.ok || (await result.text()).trim().toLowerCase() !== hash) throw new Error(`${name} submission is unverified.`)
      } }
    },
  }
}

function ownScript(owner: string, params: UtxoParams) {
  const decoded = Address(params.network).decode(owner)
  if (decoded.type !== params.kind) throw new Error(`Unexpected ${params.name} wallet address type.`)
  return OutScript.encode(decoded)
}

export async function bitcoinStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!hashPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  const result = await bitcoinApi(endpoint, `/tx/${item.hash}/status`, fetcher)
  if (result.status === 404) return item.status
  if (!result.ok) throw new Error('Confirmation is unavailable.')
  return (await result.json() as { confirmed?: boolean }).confirmed === true ? 'confirmed' : item.status
}

export async function xrpRequest(endpoint: string, method: string, params: Record<string, unknown>, fetcher: typeof fetch) {
  const response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: [params] }) })
  if (!response.ok) throw new Error('The XRP Ledger provider returned an unsuccessful response.')
  return (await response.json() as { result?: Record<string, unknown> & { status?: string; error?: string } }).result ?? {}
}

export async function xrpServer(endpoint: string, fetcher: typeof fetch) {
  const result = await xrpRequest(endpoint, 'server_info', {}, fetcher)
  const info = result.info as { network_id?: number; validated_ledger?: { seq?: number; reserve_base_xrp?: number; reserve_inc_xrp?: number } } | undefined
  if (result.status !== 'success' || !info?.validated_ledger) throw new Error('The XRP Ledger provider is unavailable.')
  if (info.network_id !== 0) throw new Error('The provider did not verify the XRP Ledger mainnet.')
  return info.validated_ledger
}

function xrpDestination(recipient: string, tagInput: string) {
  let to = recipient.trim()
  let tag: number | undefined
  if (tagInput.trim()) {
    if (!/^\d{1,10}$/.test(tagInput.trim()) || Number(tagInput) > 0xffff_ffff) throw new Error('Enter a destination tag between 0 and 4294967295.')
    tag = Number(tagInput)
  }
  if (isValidXAddress(to)) {
    const decoded = xAddressToClassicAddress(to)
    if (decoded.test || (decoded.tag !== false && tag !== undefined && decoded.tag !== tag)) throw new Error('The XRP address uses a different network or destination tag.')
    to = decoded.classicAddress
    if (decoded.tag !== false) tag = decoded.tag
  }
  if (!isValidClassicAddress(to) || ['rrrrrrrrrrrrrrrrrrrrrhoLvTp', 'rrrrrrrrrrrrrrrrrrrrBZbvji'].includes(to)) {
    throw new Error('Enter a valid XRP Ledger mainnet recipient address.')
  }
  return { to, tag }
}

export async function quoteXrp(network: Network, endpoint: string, from: string, recipient: string, amount: string, tagInput: string, fetcher: typeof fetch): Promise<Quote> {
  const { to, tag } = xrpDestination(recipient, tagInput)
  if (from === to) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, 6)
  if (value > 100_000_000_000_000_000n) throw new Error('The XRP amount is above the network supply.')
  const [ledger, source, target, fees] = await Promise.all([
    xrpServer(endpoint, fetcher),
    xrpRequest(endpoint, 'account_info', { account: from, ledger_index: 'current', queue: true }, fetcher),
    xrpRequest(endpoint, 'account_info', { account: to, ledger_index: 'validated' }, fetcher),
    xrpRequest(endpoint, 'fee', {}, fetcher),
  ])
  if (source.error === 'actNotFound') throw new Error('Fund your XRP address before sending.')
  const account = source.account_data as { Balance?: string; Sequence?: number; OwnerCount?: number } | undefined
  const feeDrops = (fees.drops as { open_ledger_fee?: string } | undefined)?.open_ledger_fee
  const base = ledger.reserve_base_xrp
  const increment = ledger.reserve_inc_xrp
  if (source.status !== 'success' || fees.status !== 'success' || !account?.Balance || !account.Sequence ||
    account.OwnerCount === undefined || !feeDrops || !ledger.seq || base === undefined || increment === undefined) {
    throw new Error('The XRP Ledger provider could not prepare this payment.')
  }
  if (Number((source.queue_data as { txn_count?: number } | undefined)?.txn_count ?? 0) > 0) throw new Error('Wait for your pending XRP payment before sending again.')
  const fee = BigInt(feeDrops)
  if (fee <= 0n || fee > 10_000n) throw new Error('The XRP Ledger network fee is above 0.01 XRP or unavailable.')
  const reserveBase = base ? parseAmount(String(base), 6) : 0n
  const reserveIncrement = increment ? parseAmount(String(increment), 6) : 0n
  if (BigInt(account.Balance) < value + fee + reserveBase + BigInt(account.OwnerCount) * reserveIncrement) {
    throw new Error('Insufficient spendable XRP after the network fee and account reserve.')
  }
  if (target.error === 'actNotFound') {
    if (value < reserveBase) throw new Error(`Send at least ${formatAmount(reserveBase, 6)} XRP to activate this address.`)
  } else {
    if (target.status !== 'success') throw new Error('Could not verify the XRP destination.')
    const flags = (target.account_data as { Flags?: number } | undefined)?.Flags
    if (flags === undefined) throw new Error('Could not verify recipient settings.')
    if ((flags & 0x00020000) && tag === undefined) throw new Error('This recipient requires a destination tag.')
  }
  const sequence = account.Sequence
  const lastLedgerSequence = ledger.seq + xrpLedgerWindow
  const expires = Date.now() + 20_000
  return {
    to, value: formatAmount(value, 6), fee: formatAmount(fee, 6), network, expires, destinationTag: tag,
    async sign(session) {
      if (session.addresses.xrp !== from) throw new Error('This quote belongs to a different wallet.')
      const current = await xrpRequest(endpoint, 'account_info', { account: from, ledger_index: 'current', queue: true }, fetcher)
      if (current.status !== 'success' || (current.account_data as { Sequence?: number } | undefined)?.Sequence !== sequence ||
        Number((current.queue_data as { txn_count?: number } | undefined)?.txn_count ?? 0) > 0 || Date.now() > expires) {
        throw new Error('The XRP account state changed or the quote expired. Request another quote.')
      }
      const key = await xrpKey(session.mnemonic, session.account)
      try {
        const payment = {
          TransactionType: 'Payment', Account: from, Destination: to, Amount: value.toString(),
          Fee: fee.toString(), Sequence: sequence, LastLedgerSequence: lastLedgerSequence,
          ...(tag !== undefined && { DestinationTag: tag }),
          SigningPubKey: hex.encode(key.publicKey!).toUpperCase(),
        }
        const TxnSignature = sign(encodeForSigning(payment), hex.encode(key.privateKey!))
        const blob = encode({ ...payment, TxnSignature })
        const hash = hex.encode(sha512(hex.decode('54584E00' + blob)).subarray(0, 32)).toUpperCase()
        return { hash, lastLedgerSequence, async broadcast() {
          const result = await xrpRequest(endpoint, 'submit', { tx_blob: blob, fail_hard: true }, fetcher)
          const received = result.tx_json as { hash?: string } | undefined
          if (result.engine_result !== 'tesSUCCESS' || String(result.hash ?? received?.hash).toUpperCase() !== hash) {
            throw new Error('XRP submission is unverified.')
          }
        } }
      } finally {
        key.wipePrivateData()
      }
    },
  }
}

export async function xrpStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!hashPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  const last = item.lastLedgerSequence
  const result = await xrpRequest(endpoint, 'tx', { transaction: item.hash, ...(last && { min_ledger: last - xrpLedgerWindow, max_ledger: last }) }, fetcher)
  if (result.validated === true) return (result.meta as { TransactionResult?: string } | undefined)?.TransactionResult === 'tesSUCCESS' ? 'confirmed' : 'failed'
  if (last && result.error === 'txnNotFound' && result.searched_all === true && ((await xrpServer(endpoint, fetcher)).seq ?? 0) > last) return 'expired'
  if (result.status !== 'success' && result.error !== 'txnNotFound') throw new Error('XRP transaction status is unavailable.')
  return item.status
}
