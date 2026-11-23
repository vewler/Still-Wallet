import { hex } from '@scure/base'
import { sha512 } from '@noble/hashes/sha2.js'
import { Address, p2wpkh, selectUTXO } from '@scure/btc-signer'
import { encode, encodeForSigning } from 'ripple-binary-codec'
import { isValidClassicAddress, isValidXAddress, xAddressToClassicAddress } from 'ripple-address-codec'
import { sign } from 'ripple-keypairs'
import { bitcoinKey, xrpKey } from './keys'
import { formatAmount, parseAmount, type Network } from './networks'
import type { ActivityItem } from './storage'
import type { Quote } from './rpc'

const bitcoinGenesis = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
const hashPattern = /^[a-f\d]{64}$/i
const xrpLedgerWindow = 10

function bitcoinApi(endpoint: string, path: string, fetcher: typeof fetch, options?: RequestInit) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/+$/, '') + path
  return fetcher(url, options)
}

async function bitcoinRead(endpoint: string, path: string, fetcher: typeof fetch) {
  const result = await bitcoinApi(endpoint, path, fetcher)
  if (!result.ok) throw new Error('The Bitcoin provider could not load transaction data.')
  return result
}

export async function checkBitcoinNetwork(endpoint: string, fetcher: typeof fetch) {
  const result = await bitcoinRead(endpoint, '/block-height/0', fetcher)
  if ((await result.text()).trim() !== bitcoinGenesis) throw new Error('The provider is connected to a different Bitcoin network.')
}

type Utxo = { txid: string; vout: number; value: number; status?: { confirmed?: boolean } }

export async function quoteBitcoin(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: typeof fetch): Promise<Quote> {
  const to = recipient.trim()
  try { Address().decode(to) } catch { throw new Error('Enter a valid Bitcoin mainnet address.') }
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('Enter an address other than your own.')
  const value = parseAmount(amount, 8)
  if (value < 546n || value > 2_100_000_000_000_000n) throw new Error('Enter a Bitcoin amount of at least 0.00000546 BTC within the network supply.')
  await checkBitcoinNetwork(endpoint, fetcher)
  const [unspent, estimates] = await Promise.all([
    bitcoinRead(endpoint, `/address/${from}/utxo`, fetcher).then((result) => result.json() as Promise<Utxo[]>),
    bitcoinRead(endpoint, '/fee-estimates', fetcher).then((result) => result.json() as Promise<Record<string, number>>),
  ])
  const feeRate = Math.ceil(estimates['3'] ?? estimates['6'] ?? estimates['2'])
  if (!Number.isSafeInteger(feeRate) || feeRate < 1 || feeRate > 2_000) throw new Error('Bitcoin network fees are currently unavailable.')
  const spend = p2wpkhFromAddress(from)
  const seen = new Set<string>()
  const candidates = unspent.filter((utxo) => {
    const outpoint = `${utxo.txid}:${utxo.vout}`.toLowerCase()
    if (!utxo.status?.confirmed || !hashPattern.test(utxo.txid) || !Number.isInteger(utxo.vout) ||
      utxo.vout < 0 || utxo.vout > 0xffff_ffff || !Number.isSafeInteger(utxo.value) ||
      utxo.value <= 0 || utxo.value > 2_100_000_000_000_000 || seen.has(outpoint)) return false
    seen.add(outpoint)
    return true
  }).sort((a, b) => b.value - a.value)
  // Max 24 confirmed inputs per quote. Fragmented balances would need consolidation.
  const options = candidates.slice(0, 24).map(({ txid, vout, value }) => ({
    txid, index: vout, witnessUtxo: { script: spend, amount: BigInt(value) },
  }))
  if (!options.length) throw new Error('There is no confirmed BTC to spend from this address.')
  const selected = selectUTXO(options, [{ address: to, amount: value }], 'default', {
    feePerByte: BigInt(feeRate), changeAddress: from, strictPrevoutValidation: true,
  })
  if (!selected?.tx) throw new Error('Insufficient confirmed BTC in the available inputs to cover this amount and fee.')
  const { tx } = selected
  for (let start = 0; start < tx.inputsLength; start += 6) {
    await Promise.all(Array.from({ length: Math.min(6, tx.inputsLength - start) }, async (_, offset) => {
      const index = start + offset
      const input = tx.getInput(index)
      const result = await bitcoinRead(endpoint, `/tx/${hex.encode(input.txid!)}/hex`, fetcher)
      tx.updateInput(index, { nonWitnessUtxo: hex.decode((await result.text()).trim()) })
    }))
  }
  const fee = tx.fee
  const expires = Date.now() + 45_000
  return {
    to, value: formatAmount(value, 8), fee: formatAmount(fee, 8), network, expires,
    async sign(session) {
      const key = await bitcoinKey(session.mnemonic, session.account)
      try {
        if (p2wpkh(key.publicKey!).address !== from) throw new Error('This quote belongs to a different wallet.')
        tx.sign(key.privateKey!)
        tx.finalize()
      } finally {
        key.wipePrivateData()
      }
      const hash = tx.id
      const raw = tx.hex
      return { hash, async broadcast() {
        const result = await bitcoinApi(endpoint, '/tx', fetcher, { method: 'POST', body: raw, headers: { 'Content-Type': 'text/plain' } })
        if (!result.ok || (await result.text()).trim().toLowerCase() !== hash) throw new Error('Bitcoin submission is unverified.')
      } }
    },
  }
}

function p2wpkhFromAddress(owner: string) {
  const decoded = Address().decode(owner)
  if (decoded.type !== 'wpkh') throw new Error('Unexpected Bitcoin wallet address type.')
  return Uint8Array.of(0, 20, ...decoded.hash)
}

export async function bitcoinStatus(item: ActivityItem, endpoint: string, fetcher: typeof fetch): Promise<ActivityItem['status']> {
  if (!hashPattern.test(item.hash)) throw new Error('Invalid transaction ID.')
  const result = await bitcoinApi(endpoint, `/tx/${item.hash}/status`, fetcher)
  if (result.status === 404) return item.status
  if (!result.ok) throw new Error('Bitcoin confirmation is unavailable.')
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
