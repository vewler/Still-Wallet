import {
  address, appendTransactionMessageInstructions, getAddressEncoder, getProgramDerivedAddress, compileTransaction, createNoopSigner,
  createSolanaRpcFromTransport, createTransactionMessage, getBase64Decoder,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, lamports,
  partiallySignTransaction, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, signature,
  type TransactionMessageBytesBase64,
} from '@solana/kit'
import { parseJsonWithBigInts, stringifyJsonWithBigInts } from '@solana/rpc-spec-types'
import { getTransferSolInstruction } from '@solana-program/system'
import { getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from '@solana-program/token'
import { createPublicClient, defineChain, encodeFunctionData, erc20Abi, getAddress, http, keccak256, type Address, type Hex } from 'viem'
import { estimateL1Fee, estimateOperatorFee } from 'viem/op-stack'
import { addressFor, formatAmount, l1Chains, networks, parseAmount, utxoChains, type Addresses, type Network } from './networks'
import { tokenById, tokenPriceIds, type Token } from './tokens'
import { type ActivityItem } from './storage'
import { evmAccount, solanaKeypair, type Session } from './vault'

const responseLimit = 16 * 1024 * 1024

export function privateFetch(signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController()
    const sources = [signal, init?.signal].filter((source): source is AbortSignal => Boolean(source))
    const abort = () => controller.abort()
    sources.forEach((source) => {
      if (source.aborted) abort()
      else source.addEventListener('abort', abort, { once: true })
    })
    const timeout = setTimeout(abort, 12_000)
    try {
      const response = await fetch(input, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' })
      // Read the body within the same timeout, and never more than a provider would sensibly send (a bad custom RPC could freeze the tab).
      if (Number(response.headers.get('content-length')) > responseLimit) { abort(); throw new Error('The RPC sent too much data.') }
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      if (reader) for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > responseLimit) { abort(); throw new Error('The RPC sent too much data.') }
        chunks.push(value)
      }
      const body = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally {
      clearTimeout(timeout)
      sources.forEach((source) => source.removeEventListener('abort', abort))
    }
  }
}

export async function evmClient(network: Network, endpoint: string, signal: AbortSignal) {
  const chain = defineChain({
    id: network.chainId!,
    name: `${network.name} ${network.label}`,
    nativeCurrency: { name: network.symbol, symbol: network.symbol, decimals: network.decimals },
    rpcUrls: { default: { http: [endpoint] } },
  })
  const client = createPublicClient({
    chain,
    cacheTime: 0,
    ccipRead: false,
    transport: http(endpoint, { retryCount: 0, timeout: 12_000, fetchFn: privateFetch(signal) }),
  })
  if (await client.getChainId() !== chain.id) throw new Error('The RPC endpoint is connected to a different network.')
  return client
}

async function solanaClient(network: Network, endpoint: string, signal: AbortSignal) {
  const fetchRpc = privateFetch(signal)
  const client = createSolanaRpcFromTransport(async <TResponse>({ payload }: { payload: unknown }) => {
    const response = await fetchRpc(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: stringifyJsonWithBigInts(payload),
    })
    if (!response.ok) throw new Error('The Solana RPC returned an unsuccessful response.')
    return parseJsonWithBigInts(await response.text()) as TResponse
  })
  if (await client.getGenesisHash().send() !== network.genesis) throw new Error('The RPC endpoint is connected to a different network.')
  return client
}

/** Bitcoin uses an Esplora-style REST API (mempool.space by default). */
async function bitcoinBalance(endpoint: string, owner: string, signal: AbortSignal) {
  const url = new URL(endpoint)
  // Bitcoin Cash providers take the CashAddr without its prefix.
  url.pathname = url.pathname.replace(/\/+$/, '') + '/address/' + encodeURIComponent(owner.replace(/^bitcoincash:/, ''))
  const response = await privateFetch(signal)(url)
  if (!response.ok) throw new Error('The balance provider returned an unsuccessful response.')
  const data = await response.json() as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }; mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }
  const sum = (stats?: { funded_txo_sum?: number; spent_txo_sum?: number }) => BigInt(stats?.funded_txo_sum ?? 0) - BigInt(stats?.spent_txo_sum ?? 0)
  if (!data.chain_stats || !data.mempool_stats) throw new Error('The balance provider did not return a balance.')
  return sum(data.chain_stats) + sum(data.mempool_stats)
}

async function xrpBalance(endpoint: string, owner: string, signal: AbortSignal) {
  const { xrpRequest } = await import('./ledgerTransfers')
  const result = await xrpRequest(endpoint, 'account_info', { account: owner, ledger_index: 'validated' }, privateFetch(signal))
  if (result.error === 'actNotFound') return 0n
  const balance = (result.account_data as { Balance?: string } | undefined)?.Balance
  if (result.status !== 'success' || typeof balance !== 'string') throw new Error('The XRP Ledger server could not load the balance.')
  return BigInt(balance)
}

/** Plain JSON call to a Monero daemon (or the Still proxy in front of one). */
async function moneroRequest(endpoint: string, path: string, body: unknown, signal: AbortSignal) {
  const response = await privateFetch(signal)(endpoint.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('The Monero node returned an unsuccessful response.')
  return await response.json() as Record<string, unknown>
}

export async function testEndpoint(network: Network, endpoint: string, signal: AbortSignal) {
  if (network.chain === 'monero') {
    const info = await moneroRequest(endpoint, '/json_rpc', { jsonrpc: '2.0', id: '0', method: 'get_info' }, signal)
    if ((info.result as { nettype?: string } | undefined)?.nettype !== 'mainnet') throw new Error('The RPC endpoint is connected to a different network.')
    return
  }
  if (utxoChains.has(network.chain)) return (await import('./ledgerTransfers')).checkBitcoinNetwork(endpoint, privateFetch(signal), network)
  if (network.chain === 'tron') return (await import('./tron')).checkTron(endpoint, privateFetch(signal))
  if (network.chain === 'kaspa') return (await import('./kaspa')).checkKaspa(endpoint, privateFetch(signal))
  if (network.chain === 'sui') { await (await import('./sui')).checkSui(endpoint, privateFetch(signal)); return }
  if (network.chain === 'aptos') return (await import('./aptos')).checkAptos(endpoint, privateFetch(signal))
  if (l1Chains.has(network.chain)) return (await import('./l1/index')).l1Check(network, endpoint, privateFetch(signal))
  if (network.chain === 'xrp') { await (await import('./ledgerTransfers')).xrpServer(endpoint, privateFetch(signal)); return }
  if (network.chain === 'solana') await (await solanaClient(network, endpoint, signal)).getBlockHeight({ commitment: 'confirmed' }).send()
  else await evmClient(network, endpoint, signal)
}

export async function getBalance(network: Network, endpoint: string, addresses: Addresses, signal: AbortSignal) {
  const accountAddress = addressFor(network, addresses)
  if (network.chain === 'monero') throw new Error('Monero balances need the unlocked wallet.')
  if (utxoChains.has(network.chain)) return bitcoinBalance(endpoint, accountAddress, signal)
  if (network.chain === 'tron') return (await import('./tron')).tronBalance(endpoint, accountAddress, privateFetch(signal))
  if (network.chain === 'kaspa') return (await import('./kaspa')).kaspaBalance(endpoint, accountAddress, privateFetch(signal))
  if (network.chain === 'sui') return (await import('./sui')).suiBalance(endpoint, accountAddress, privateFetch(signal))
  if (network.chain === 'aptos') return (await import('./aptos')).aptosBalance(endpoint, accountAddress, privateFetch(signal))
  if (l1Chains.has(network.chain)) return (await import('./l1/index')).l1Balance(network, endpoint, accountAddress, privateFetch(signal))
  if (network.chain === 'xrp') return xrpBalance(endpoint, accountAddress, signal)
  if (network.chain === 'solana') {
    const client = await solanaClient(network, endpoint, signal)
    return (await client.getBalance(address(accountAddress), { commitment: 'confirmed' }).send()).value
  }
  const client = await evmClient(network, endpoint, signal)
  return client.getBalance({ address: getAddress(accountAddress) })
}

const tokenProgram = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const token2022Program = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const associatedTokenProgram = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

async function associatedTokenAddress(owner: string, mint: string) {
  const encoder = getAddressEncoder()
  const [pda] = await getProgramDerivedAddress({ programAddress: associatedTokenProgram, seeds: [encoder.encode(address(owner)), encoder.encode(tokenProgram), encoder.encode(address(mint))] })
  return pda
}

/** Token balances for one network over one connection. Missing token account = 0. */
export async function getTokenBalances(network: Network, endpoint: string, addresses: Addresses, list: Token[], signal: AbortSignal) {
  const owner = addressFor(network, addresses)
  const result: Record<string, bigint> = {}
  if (!list.length) return result
  if (network.chain === 'tron') return (await import('./tron')).tronTokenBalances(endpoint, owner, list, privateFetch(signal))
  if (network.chain === 'solana') {
    const client = await solanaClient(network, endpoint, signal)
    // Read each ATA directly, free RPCs block owner-wide token queries.
    const accounts = await Promise.all(list.map((token) => associatedTokenAddress(owner, token.contract)))
    const { value } = await client.getMultipleAccounts(accounts, { encoding: 'jsonParsed', commitment: 'confirmed' }).send()
    list.forEach((token, index) => {
      const parsed = (value[index]?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | undefined)?.parsed
      result[token.id] = BigInt(parsed?.info?.tokenAmount?.amount ?? '0')
    })
    return result
  }
  const client = await evmClient(network, endpoint, signal)
  await Promise.all(list.map(async (token) => {
    result[token.id] = await client.readContract({ address: getAddress(token.contract), abi: erc20Abi, functionName: 'balanceOf', args: [getAddress(owner)] })
  }))
  return result
}

export type Prices = Partial<Record<string, number>>

/** Spot prices and 24h change via the Still server. */
export async function getPrices(currency: string, signal: AbortSignal): Promise<{ prices: Prices; changes: Prices }> {
  const ids = [...new Set([...Object.values(networks).map((network) => network.priceId), ...tokenPriceIds()])]
  const response = await privateFetch(signal)(`/api/market/prices?currency=${encodeURIComponent(currency)}`)
  if (!response.ok) throw new Error('Prices are unavailable.')
  const data = await response.json() as Record<string, Record<string, unknown> | undefined>
  const price = (id: string) => { const value = data[id]?.[currency]; return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined }
  const change = (id: string) => { const value = data[id]?.[`${currency}_24h_change`]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
  return { prices: Object.fromEntries(ids.map((id) => [id, price(id)])), changes: Object.fromEntries(ids.map((id) => [id, change(id)])) }
}

/** Price history for one coin. Only sends the coin id and currency. */
export async function getPriceHistory(priceId: string, currency: string, days: number, signal: AbortSignal): Promise<number[]> {
  const response = await privateFetch(signal)(`/api/market/history/${encodeURIComponent(priceId)}?currency=${encodeURIComponent(currency)}&days=${days}`)
  if (!response.ok) throw Object.assign(new Error('Price history is unavailable.'), { status: response.status })
  const data = await response.json() as { prices?: unknown }
  if (!Array.isArray(data.prices)) throw new Error('Price history is unavailable.')
  return data.prices.map((entry) => Array.isArray(entry) ? Number(entry[1]) : NaN).filter((value) => Number.isFinite(value) && value >= 0)
}

export type Candle = { time: number; open: number; high: number; low: number; close: number }

/** Real OHLC candles for one coin, oldest first. */
export async function getOhlc(priceId: string, currency: string, days: number, signal: AbortSignal): Promise<Candle[]> {
  const response = await privateFetch(signal)(`/api/market/ohlc/${encodeURIComponent(priceId)}?currency=${encodeURIComponent(currency)}&days=${days}`)
  if (!response.ok) throw Object.assign(new Error('Price history is unavailable.'), { status: response.status })
  const data = await response.json() as unknown
  if (!Array.isArray(data)) throw new Error('Price history is unavailable.')
  return data.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 5) return []
    const [time, open, high, low, close] = row.slice(0, 5).map(Number)
    return [time, open, high, low, close].every((value) => Number.isFinite(value) && value >= 0) && high >= low ? [{ time, open, high, low, close }] : []
  })
}

/** 7d lines for many coins in one call, keyed by coin id. */
export async function getSparklines(priceIds: string[], currency: string, signal: AbortSignal): Promise<Record<string, number[]>> {
  const response = await privateFetch(signal)(`/api/market/sparklines?currency=${encodeURIComponent(currency)}`)
  if (!response.ok) throw Object.assign(new Error('Price history is unavailable.'), { status: response.status })
  const data = await response.json() as { id?: unknown; sparkline_in_7d?: { price?: unknown } }[]
  if (!Array.isArray(data)) throw new Error('Price history is unavailable.')
  const result: Record<string, number[]> = {}
  for (const entry of data) {
    const prices = entry.sparkline_in_7d?.price
    if (typeof entry.id === 'string' && priceIds.includes(entry.id) && Array.isArray(prices)) result[entry.id] = prices.map(Number).filter((value) => Number.isFinite(value) && value >= 0)
  }
  return result
}

type SignedTransfer = {
  hash: string
  lastValidBlockHeight?: number
  lastLedgerSequence?: number
  from?: string
  broadcast: () => Promise<void>
}

export type Quote = {
  to: string
  value: string
  fee: string
  asset?: string
  rent?: string
  destinationTag?: number
  kind?: ActivityItem['kind']
  receive?: { amount: string; minimum: string; symbol: string; network?: string; slippage?: number; auto?: boolean; impact?: number; market?: number; unchecked?: boolean }
  /** Who receives the coins in a swap, shown on review. */
  via?: string
  /** Cross-chain swaps: seconds until the coins arrive. */
  eta?: number
  /** Connected app that asked for this transaction. */
  app?: string
  network: Network
  expires: number
  sign: (session: Session) => Promise<SignedTransfer>
}

export async function quoteTransfer(network: Network, endpoint: string, addresses: Addresses, recipient: string, amount: string, signal: AbortSignal, asset?: string, tag = ''): Promise<Quote> {
  const token = asset ? tokenById(asset) : undefined
  if (asset && (!token || token.network !== network.id)) throw new Error('Select an asset on the chosen network.')
  if (network.chain === 'monero') throw new Error('Monero transfers need the unlocked wallet.')
  if (utxoChains.has(network.chain)) return (await import('./ledgerTransfers')).quoteBitcoin(network, endpoint, addressFor(network, addresses), recipient, amount, privateFetch(signal))
  if (network.chain === 'sui') return (await import('./sui')).quoteSui(network, endpoint, addresses.sui, recipient, amount, privateFetch(signal))
  if (network.chain === 'aptos') return (await import('./aptos')).quoteAptos(network, endpoint, addresses.aptos, addresses.aptosPublicKey, recipient, amount, privateFetch(signal))
  if (network.chain === 'kaspa') return (await import('./kaspa')).quoteKaspa(network, endpoint, addresses.kaspa, recipient, amount, privateFetch(signal))
  if (network.chain === 'tron') return (await import('./tron')).quoteTron(network, endpoint, addresses.tron, recipient, amount, token, privateFetch(signal))
  if (l1Chains.has(network.chain)) return (await import('./l1/index')).l1Quote(network, endpoint, addressFor(network, addresses), recipient, amount, tag, privateFetch(signal))
  if (network.chain === 'xrp') return (await import('./ledgerTransfers')).quoteXrp(network, endpoint, addresses.xrp, recipient, amount, tag, privateFetch(signal))
  const decimals = token?.decimals ?? network.decimals
  const value = parseAmount(amount, decimals)
  const display = formatAmount(value, decimals)
  if (network.chain === 'solana') {
    let to: ReturnType<typeof address>
    try { to = address(recipient.trim()) } catch { throw new Error('Enter a valid Solana address.') }
    const from = address(addresses.solana)
    if (from === to) throw new Error('Enter an address other than your own.')
    const client = await solanaClient(network, endpoint, signal)
    const [{ value: lifetime }, { value: balance }, { value: [recipientAccount] }] = await Promise.all([
      client.getLatestBlockhash({ commitment: 'confirmed' }).send(),
      client.getBalance(from, { commitment: 'confirmed' }).send(),
      client.getMultipleAccounts([to], { encoding: 'base64', commitment: 'confirmed' }).send(),
    ])
    // Funds sent to a token account (or an ATA made for it) are stuck.
    if (recipientAccount?.owner === tokenProgram || recipientAccount?.owner === token2022Program) throw new Error('This is a token account, not a wallet address. Ask the recipient for their Solana wallet address.')
    const authority = createNoopSigner(from)
    let rent = 0n
    let instructions
    if (token) {
      const mint = address(token.contract)
      const [source, destination] = await Promise.all([associatedTokenAddress(from, mint), associatedTokenAddress(to, mint)])
      const { value: [sourceAccount, targetAccount] } = await client.getMultipleAccounts([source, destination], { encoding: 'jsonParsed', commitment: 'confirmed' }).send()
      const parsed = (sourceAccount?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } } | undefined)?.parsed
      if (BigInt(parsed?.info?.tokenAmount?.amount ?? '0') < value) throw new Error(`Insufficient ${token.symbol} in your associated token account.`)
      if (targetAccount && targetAccount.owner !== tokenProgram) throw new Error('The recipient token account is invalid.')
      if (!targetAccount) rent = await client.getMinimumBalanceForRentExemption(165n, { commitment: 'confirmed' }).send()
      instructions = [
        ...(!targetAccount ? [getCreateAssociatedTokenIdempotentInstruction({ payer: authority, ata: destination, owner: to, mint })] : []),
        getTransferCheckedInstruction({ source, mint, destination, authority, amount: value, decimals }),
      ]
    } else {
      instructions = [getTransferSolInstruction({ source: authority, destination: to, amount: lamports(value) })]
    }
    const transaction = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (message) => setTransactionMessageFeePayer(from, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) => appendTransactionMessageInstructions(instructions, message),
      compileTransaction,
    )
    const messageBase64 = getBase64Decoder().decode(transaction.messageBytes) as TransactionMessageBytesBase64
    const { value: fee } = await client.getFeeForMessage(messageBase64, { commitment: 'confirmed' }).send()
    if (fee === null) throw new Error('The Solana fee quote expired. Request another quote.')
    if (balance < (token ? 0n : value) + fee + rent) throw new Error('Insufficient SOL to cover this transfer and any token account rent.')
    const expires = Date.now() + 30_000
    return {
      to, value: display, fee: formatAmount(fee, 9), network, expires, asset,
      rent: rent ? formatAmount(rent, 9) : undefined,
      async sign(session) {
        const key = await solanaKeypair(session.mnemonic, session.account)
        if (key.address !== from) throw new Error('This quote belongs to a different wallet.')
        if (Date.now() > expires || await client.getBlockHeight({ commitment: 'confirmed' }).send() > lifetime.lastValidBlockHeight) {
          throw new Error('The Solana quote expired. Request another quote.')
        }
        const signed = await partiallySignTransaction([key.keyPair], transaction)
        const raw = getBase64EncodedWireTransaction(signed)
        const hash = getSignatureFromTransaction(signed)
        return {
          hash, lastValidBlockHeight: Number(lifetime.lastValidBlockHeight),
          async broadcast() {
            const received = await client.sendTransaction(raw, {
              encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0n,
            }).send()
            if (received !== hash) throw new Error('The RPC returned an unexpected transaction ID.')
          },
        }
      },
    }
  }

  let to: Address
  try {
    const address = recipient.trim()
    to = getAddress(address)
    if (address !== address.toLowerCase() && address !== to) throw new Error('Checksum mismatch.')
    if (BigInt(to) === 0n) throw new Error('Zero address.')
  } catch { throw new Error('Enter a valid Ethereum-format address with the correct checksum.') }
  const from = getAddress(addresses.ethereum)
  if (from === to) throw new Error('Enter an address other than your own.')
  if (token && to === getAddress(token.contract)) throw new Error(`That is the ${token.symbol} contract itself. Tokens sent there are lost; use the recipient's wallet address.`)
  const client = await evmClient(network, endpoint, signal)
  const request = token ? {
    to: getAddress(token.contract), value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, value] }),
  } : { to, value }
  if (token && await client.readContract({ address: request.to, abi: erc20Abi, functionName: 'balanceOf', args: [from] }) < value) {
    throw new Error(`Insufficient ${token.symbol} to cover this transfer.`)
  }
  return quoteEvm(network, client, from, request, { to, value: display, asset })
}

/** A transaction a connected app asked for. */
export async function quoteDapp(network: Network, endpoint: string, from: string, call: { to?: string; value?: string; data?: Hex }, app: string, signal: AbortSignal): Promise<Quote> {
  if (!call.to) throw new Error('Deploying contracts from apps isn’t supported.')
  const to = getAddress(call.to)
  const value = call.value ? BigInt(call.value) : 0n
  const client = await evmClient(network, endpoint, signal)
  const data = call.data && call.data !== '0x' ? call.data : undefined
  return { ...await quoteEvm(network, client, getAddress(from), { to, value, data }, { to, value: formatAmount(value, network.decimals), kind: 'dapp' }), app }
}

export async function quoteEvm(network: Network, client: Awaited<ReturnType<typeof evmClient>>, from: Address, transaction: { to: Address; value: bigint; data?: Hex }, details: Pick<Quote, 'to' | 'value' | 'asset' | 'kind' | 'receive'>): Promise<Quote> {
  const request = { account: from, ...transaction }
  const feeFields = network.chain === 'bnb' || network.chain === 'ethereumclassic'
    ? client.getGasPrice().then((gasPrice) => ({ type: 'legacy' as const, gasPrice }))
    : client.estimateFeesPerGas({ type: 'eip1559' }).then((fees) => ({ type: 'eip1559' as const, ...fees }))
  const [estimate, fees, balance, nonce] = await Promise.all([
    // Gas estimation reverts on a low balance, keep the error for the balance check below.
    client.estimateGas(request).catch((problem: unknown) => problem instanceof Error ? problem : new Error(String(problem))),
    feeFields,
    client.getBalance({ address: from, blockTag: 'pending' }),
    client.getTransactionCount({ address: from, blockTag: 'pending' }),
  ])
  if (balance < transaction.value) throw new Error(`Insufficient ${network.symbol} to cover the amount and network fee.`)
  if (estimate instanceof Error) {
    throw new Error(balance === 0n ? `Insufficient ${network.symbol} to cover the network fee.` : 'The network rejected this transaction in a test run. Check the amount and balances, then try again.')
  }
  const estimatedGas = estimate
  const gas = estimatedGas > 21_000n ? (estimatedGas * 120n + 99n) / 100n : estimatedGas
  const extra = network.chain === 'base' || network.chain === 'optimism' ? await Promise.all([
    estimateL1Fee(client, { ...request, gasPriceOracleAddress: '0x420000000000000000000000000000000000000F' }),
    estimateOperatorFee(client, { ...request, gasPriceOracleAddress: '0x420000000000000000000000000000000000000F' }),
  ]) : [0n, 0n]
  const fee = gas * (fees.type === 'legacy' ? fees.gasPrice : fees.maxFeePerGas) + extra[0] + extra[1]
  if (balance < transaction.value + fee) throw new Error(`Insufficient ${network.symbol} to cover the amount and network fee.`)
  const expires = Date.now() + 45_000
  return {
    ...details, fee: formatAmount(fee, network.decimals), network, expires,
    async sign(session) {
      if (await client.getTransactionCount({ address: from, blockTag: 'pending' }) !== nonce) {
        throw new Error('Your pending transactions changed. Request another quote.')
      }
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const account = evmAccount(session.mnemonic, session.account)
      if (account.address !== from) throw new Error('This quote belongs to a different wallet.')
      const signed = await account.signTransaction({ ...transaction, ...fees, chainId: client.chain.id, nonce, gas })
      const hash = keccak256(signed)
      return {
        hash,
        async broadcast() {
          if (await client.sendRawTransaction({ serializedTransaction: signed }) !== hash) {
            throw new Error('The RPC returned an unexpected transaction ID.')
          }
        },
      }
    },
  }
}

export async function checkTransaction(item: ActivityItem, network: Network, endpoint: string, signal: AbortSignal): Promise<ActivityItem['status']> {
  if (utxoChains.has(network.chain)) return (await import('./ledgerTransfers')).bitcoinStatus(item, endpoint, privateFetch(signal))
  if (network.chain === 'tron') return (await import('./tron')).tronStatus(item, endpoint, privateFetch(signal))
  if (network.chain === 'kaspa') return (await import('./kaspa')).kaspaStatus(item, endpoint, privateFetch(signal))
  if (network.chain === 'sui') return (await import('./sui')).suiStatus(item, endpoint, privateFetch(signal))
  if (network.chain === 'aptos') return (await import('./aptos')).aptosStatus(item, endpoint, privateFetch(signal))
  if (l1Chains.has(network.chain)) return (await import('./l1/index')).l1Status(item, network, endpoint, privateFetch(signal))
  if (network.chain === 'xrp') return (await import('./ledgerTransfers')).xrpStatus(item, endpoint, privateFetch(signal))
  if (network.chain === 'monero') {
    const reply = await moneroRequest(endpoint, '/get_transactions', { txs_hashes: [item.hash] }, signal) as { txs?: { in_pool?: boolean; block_height?: number }[] }
    const [tx] = reply.txs ?? []
    return tx && !tx.in_pool && tx.block_height ? 'confirmed' : tx ? 'submitted' : item.status
  }
  if (network.chain === 'solana') {
    const client = await solanaClient(network, endpoint, signal)
    const { value: [status] } = await client.getSignatureStatuses([signature(item.hash)], { searchTransactionHistory: true }).send()
    if (status?.err) return 'failed'
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return 'confirmed'
    if (!status && item.lastValidBlockHeight !== undefined && await client.getBlockHeight({ commitment: 'confirmed' }).send() > BigInt(item.lastValidBlockHeight)) return 'expired'
    return item.status
  }
  const client = await evmClient(network, endpoint, signal)
  const receipt = await client.request({ method: 'eth_getTransactionReceipt', params: [item.hash as Hex] })
  return receipt ? receipt.status === '0x1' ? 'confirmed' : 'failed' : item.status
}
