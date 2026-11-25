import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { registerHooks } from 'node:module'
import { after, test } from 'node:test'
import { Transaction } from '@scure/btc-signer'
import { getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder } from '@solana/kit'
import { decode, encodeForSigning } from 'ripple-binary-codec'
import { verify } from 'ripple-keypairs'
import { decodeFunctionData, encodeFunctionResult, erc20Abi, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, toHex } from 'viem'
import { createGateway } from '../server/gateway.ts'
import { createMarket } from '../server/market.ts'
import { networks } from '../src/networks.ts'

// Load extensionless TS imports in Node without a build step.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    return next(specifier, context)
  },
})
const { accountSession, newPhrase, solanaKeypair } = await import('../src/vault.ts')
const { checkTransaction, getBalance, quoteTransfer } = await import('../src/rpc.ts')
const { quoteSwap } = await import('../src/swap.ts')
const { tokens } = await import('../src/tokens.ts')
const phrase = newPhrase()
const source = await accountSession({ vault: 'fixture', root: phrase }, 0)
const recipient = await accountSession(source, 1)
const confirmed = new Set()
const lastSigned = new Map()
let allowance = 0n
const contracts = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function getL1Fee(bytes) view returns (uint256)',
  'function getOperatorFee(uint256) view returns (uint256)',
])
const previous = new Transaction()
previous.addInput({ txid: '1'.repeat(64), index: 0 })
previous.addOutputAddress(source.addresses.bitcoin, 100_000n)
const funding = Transaction.fromRaw(previous.unsignedTx)
const blockContext = (value) => ({ context: { slot: 1000 }, value })
let marketRequests = 0
const gateway = createGateway({}, async (url, init) => {
  if (typeof url === 'string' && url.startsWith('https://api.coingecko.com/api/v3/')) {
    assert.equal(new Headers(init.headers).get('accept'), 'application/json')
    assert.equal(new Headers(init.headers).get('user-agent'), 'StillWallet/0.1')
    marketRequests++
    assert.match(url, /\/simple\/price\?ids=.*&vs_currencies=usd&include_24hr_change=true$/)
    return Response.json({ bitcoin: { usd: 50_000 } })
  }
  const id = Object.values(networks).find((network) => new URL(network.rpc).host === url.host)?.id
  assert.ok(id, 'Fixture gateway never calls an external provider')
  const network = networks[id]
  if (network.chain === 'bitcoin') {
    if (url.pathname.endsWith('/block-height/0')) return new Response('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
    if (url.pathname.endsWith('/fee-estimates')) return Response.json({ 3: 2 })
    if (url.pathname.endsWith('/utxo')) return Response.json([{ txid: funding.id, vout: 0, value: 100_000, status: { confirmed: true } }])
    if (url.pathname.endsWith(`/${funding.id}/hex`)) return new Response(funding.hex)
    if (url.pathname.endsWith('/status')) return Response.json({ confirmed: confirmed.has(url.pathname.split('/').at(-2)) })
    if (init.method === 'POST' && url.pathname.endsWith('/tx')) {
      const tx = Transaction.fromRaw(Buffer.from(init.body, 'hex'))
      lastSigned.set(id, tx)
      confirmed.add(tx.id)
      return new Response(tx.id)
    }
    assert.fail(`Unexpected fixture request: ${url.pathname}`)
  }
  const rpc = JSON.parse(init.body)
  const args = rpc.params ?? []
  const response = (result) => Response.json({ jsonrpc: '2.0', id: rpc.id, result })
  if (network.chain === 'xrp') {
    const xrp = (fields) => response({ status: 'success', ...fields })
    if (rpc.method === 'server_info') return xrp({ info: { network_id: 0, validated_ledger: { seq: 1000, reserve_base_xrp: 1, reserve_inc_xrp: 0.2 } } })
    if (rpc.method === 'account_info') return xrp({ account_data: { Balance: '25000000', Sequence: 5, OwnerCount: 0, Flags: 0x00020000 } })
    if (rpc.method === 'fee') return xrp({ drops: { open_ledger_fee: '12' } })
    if (rpc.method === 'submit') {
      const tx = decode(args[0].tx_blob)
      assert.equal(verify(encodeForSigning(tx), tx.TxnSignature, tx.SigningPubKey), true)
      lastSigned.set(id, tx)
      return xrp({ engine_result: 'tesSUCCESS', tx_json: { hash: fixtureXrpHash } })
    }
    if (rpc.method === 'tx') return xrp({ validated: true, meta: { TransactionResult: 'tesSUCCESS' } })
  } else if (network.chain === 'solana') {
    if (rpc.method === 'getGenesisHash') return response(network.genesis)
    if (rpc.method === 'getBalance') return response(blockContext(10_000_000_000))
    if (rpc.method === 'getLatestBlockhash') return response(blockContext({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1100 }))
    if (rpc.method === 'getBlockHeight') return response(1000)
    if (rpc.method === 'getFeeForMessage') return response(blockContext(5000))
    if (rpc.method === 'getMinimumBalanceForRentExemption') return response(2039280)
    // The recipient check reads the recipient's own account; a plain wallet has none.
    if (rpc.method === 'getMultipleAccounts' && args[1]?.encoding === 'base64') return response(blockContext([null]))
    if (rpc.method === 'getMultipleAccounts') return response(blockContext([
      { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { info: { tokenAmount: { amount: '5000000' } } } } }, null,
    ]))
    if (rpc.method === 'sendTransaction') {
      const tx = getTransactionDecoder().decode(Buffer.from(args[0], 'base64'))
      const key = await solanaKeypair(source.mnemonic, source.account)
      assert.equal(await crypto.subtle.verify('Ed25519', key.keyPair.publicKey, tx.signatures[key.address], tx.messageBytes), true)
      lastSigned.set(id, getCompiledTransactionMessageDecoder().decode(tx.messageBytes))
      const signature = getSignatureFromTransaction(tx)
      confirmed.add(signature)
      return response(signature)
    }
    if (rpc.method === 'getSignatureStatuses') return response(blockContext([{ confirmationStatus: 'confirmed', err: null, slot: 1001, confirmations: 1 }]))
  } else {
    if (rpc.method === 'eth_chainId') return response(toHex(network.chainId))
    if (rpc.method === 'eth_getBalance') return response(toHex(10n ** 19n))
    if (rpc.method === 'eth_getTransactionCount') return response('0x0')
    if (rpc.method === 'eth_gasPrice' || rpc.method === 'eth_maxPriorityFeePerGas') return response('0x3b9aca00')
    if (rpc.method === 'eth_estimateGas') return response('0x186a0')
    if (rpc.method === 'eth_getBlockByNumber') return response({ number: '0x1000', baseFeePerGas: '0x3b9aca00', transactions: [] })
    if (rpc.method === 'eth_call') {
      const data = args[0].data
      if (data.startsWith('0x70a08231')) return response(toHex(10n ** 20n, { size: 32 }))
      if (data.startsWith('0xdd62ed3e')) return response(toHex(allowance, { size: 32 }))
      const call = decodeFunctionData({ abi: contracts, data })
      if (call.functionName === 'getAmountsOut') {
        const [input, path] = call.args
        const result = path.map((_, index) => index === 0 ? input : 2_000_000n)
        return response(encodeFunctionResult({ abi: contracts, functionName: call.functionName, result }))
      }
      if (call.functionName === 'getL1Fee' || call.functionName === 'getOperatorFee') return response(toHex(1000n, { size: 32 }))
    }
    if (rpc.method === 'eth_sendRawTransaction') {
      assert.equal(await recoverTransactionAddress({ serializedTransaction: args[0] }), source.addresses.ethereum)
      const tx = parseTransaction(args[0])
      lastSigned.set(id, tx)
      const transactionHash = keccak256(args[0])
      confirmed.add(transactionHash)
      return response(transactionHash)
    }
    if (rpc.method === 'eth_getTransactionReceipt') return response(confirmed.has(args[0]) ? { status: '0x1' } : null)
  }
  assert.fail(`Unexpected fixture RPC: ${id} ${rpc.method}`)
})
const server = createServer((request, response) => { void gateway(request, response, () => response.writeHead(404).end()) })
server.listen(0, '127.0.0.1')
await once(server, 'listening')
after(() => server.close())
const origin = `http://127.0.0.1:${server.address().port}`
const endpoint = (id) => `${origin}/api/rpc/${id}`
const signal = new AbortController().signal
let fixtureXrpHash

async function signAndConfirm(review) {
  const signed = await review.sign(source)
  if (review.network.chain === 'xrp') fixtureXrpHash = signed.hash
  await signed.broadcast()
  const id = review.network.id
  assert.equal(await checkTransaction({ ...signed, status: 'submitted' }, networks[id], endpoint(id), signal), 'confirmed')
  return lastSigned.get(id)
}

test('derives Monero keys the way Trezor does and checks XMR addresses', async () => {
  const { moneroWallet } = await import('../src/vault.ts')
  const { validMoneroAddress } = await import('../src/monero.ts')
  // Trezor's MNEMONIC12 fixture and its device test vectors.
  const all = 'alcohol woman abuse must during monitor noble actual mixed trade anger aisle'
  const first = await moneroWallet(all, 0)
  assert.equal(first.address, '4Ahp23WfMrMFK3wYL2hLWQFGt87ZTeRkufS6JoQZu6MEFDokAQeGWmu9MA3GFq1yVLSJQbKJqVAn9F9DLYGpRzRAEXqAXKM')
  assert.equal((await moneroWallet(all, 1)).address, '44iAazhoAkv5a5RqLNVyh82a1n3ceNggmN4Ho7bUBJ14WkEVR8uFTe9f7v5rNnJ2kEbVXxfXiRzsD5Jtc6NvBi4D6WNHPie')
  assert.equal((await moneroWallet(all, 2)).address, '47ejhmbZ4wHUhXaqA4b7PN667oPMkokf4ZkNdWrMSPy9TNaLVr7vLqVUQHh2MnmaAEiyrvLsX8xUf99q3j1iAeMV8YvSFcH')
  assert.ok(validMoneroAddress(first.address))
  assert.ok(!validMoneroAddress(first.address.slice(0, -1) + 'T'))
  assert.ok(!validMoneroAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'))
})
test('gateway rejects cross-origin, unsupported methods and credential-bearing XRP submits', async () => {
  assert.throws(() => createGateway({ STILL_RPC_ETHEREUM: 'malformed-fixture' }), { message: 'Invalid server RPC URL for Ethereum. Use an HTTPS URL.' })
  const health = await fetch(origin + '/api/health')
  assert.deepEqual(await health.json(), { ok: true })
  assert.equal(health.headers.get('cache-control'), 'no-store')
  const post = (network, body, headers = {}) => fetch(endpoint(network), {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  })
  assert.equal((await post('ethereum-main', { method: 'eth_chainId' }, { origin: 'https://example.com' })).status, 403)
  assert.equal((await post('ethereum-main', { method: 'personal_unlockAccount' })).status, 400)
  assert.equal((await post('xrp-main', { method: 'submit', params: [{ secret: 'fixture' }] })).status, 400)
  assert.equal((await post('solana-main', { method: 'getGenesisHash', params: [], oversized: 'a'.repeat(129 * 1024) })).status, 413)
})

test('gateway rate-limits each client per minute', async () => {
  const limited = createGateway({ STILL_RATE_LIMIT: '2' }, async () => new Response('{}'))
  const small = createServer((request, response) => { void limited(request, response, () => response.writeHead(404).end()) })
  small.listen(0, '127.0.0.1')
  await once(small, 'listening')
  try {
    const url = `http://127.0.0.1:${small.address().port}/api/market/prices?currency=usd`
    const statuses = []
    for (let index = 0; index < 3; index++) statuses.push((await fetch(url)).status)
    assert.deepEqual(statuses.slice(0, 2).map((status) => status !== 429), [true, true])
    assert.equal(statuses[2], 429)
  } finally { small.close() }
})

test('market queues bursts instead of rejecting them, and serves stale data when the provider throttles', async () => {
  let calls = 0
  let throttle = false
  const market = createMarket({}, async () => {
    calls++
    await new Promise((resolve) => setTimeout(resolve, 20))
    return throttle ? new Response('', { status: 429 }) : new Response('{"prices":[[0,1],[1,2]]}')
  })
  const ids = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'hyperliquid']
  const results = await Promise.all(ids.map((id) => market(`/api/market/history/${id}?currency=usd&days=1`, 'GET')))
  assert.deepEqual(results.map((result) => result.status), ids.map(() => 200))
  assert.equal(calls, ids.length)
  // Expire the cached entry, then make the provider rate-limit: the last good answer is served.
  const realNow = Date.now
  Date.now = () => realNow() + 10 * 60_000
  try {
    throttle = true
    const stale = await market('/api/market/history/bitcoin?currency=usd&days=1', 'GET')
    assert.equal(stale.status, 200)
    assert.equal(stale.body, '{"prices":[[0,1],[1,2]]}')
  } finally { Date.now = realNow }
})

test('market data uses canonical cache keys and rejects unsupported inputs', async () => {
  const price = origin + '/api/market/prices?currency=usd'
  const replies = await Promise.all([fetch(price), fetch(price + '&ignored=1')])
  for (const reply of replies) assert.deepEqual(await reply.json(), { bitcoin: { usd: 50_000 } })
  assert.deepEqual(await (await fetch(price)).json(), { bitcoin: { usd: 50_000 } })
  assert.equal(marketRequests, 1)
  assert.equal((await fetch(origin + '/api/market/prices?currency=invalid')).status, 400)
  assert.equal((await fetch(origin + '/api/market/history/bitcoin?currency=usd&days=10000')).status, 400)
})

test('signs and confirms native EVM sends across all four networks', async () => {
  for (const id of ['ethereum-main', 'base-main', 'bnb-main', 'hyperevm-main']) {
    const network = networks[id]
    assert.equal(await getBalance(network, endpoint(id), source.addresses, signal), 10n ** 19n)
    const review = await quoteTransfer(network, endpoint(id), source.addresses, recipient.addresses.ethereum, '1', signal)
    await assert.rejects(review.sign(recipient), /different wallet/)
    const tx = await signAndConfirm(review)
    assert.equal(tx.chainId, network.chainId)
    assert.equal(tx.to.toLowerCase(), recipient.addresses.ethereum.toLowerCase())
    assert.equal(tx.value, 10n ** 18n)
  }
})

test('signs ERC-20 sends with the token contract and recipient encoded locally', async () => {
  const network = networks['ethereum-main']
  const token = tokens.find((item) => item.id === 'ethereum-main:USDT')
  const review = await quoteTransfer(network, endpoint(network.id), source.addresses, recipient.addresses.ethereum, '1.25', signal, token.id)
  const tx = await signAndConfirm(review)
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data })
  assert.equal(tx.to.toLowerCase(), token.contract.toLowerCase())
  assert.equal(tx.value ?? 0n, 0n)
  assert.equal(decoded.functionName, 'transfer')
  assert.equal(decoded.args[0].toLowerCase(), recipient.addresses.ethereum.toLowerCase())
  assert.equal(decoded.args[1], 1_250_000n)
})

test('signs BTC only after matching the funding transaction and displays its fee', async () => {
  const id = 'bitcoin-main'
  const review = await quoteTransfer(networks[id], endpoint(id), source.addresses, recipient.addresses.bitcoin, '0.0005', signal)
  assert.ok(Number(review.fee) > 0)
  const tx = await signAndConfirm(review)
  assert.equal(tx.inputsLength, 1)
  assert.equal(tx.getInput(0).finalScriptWitness.length, 2)
  const outputs = new Map([0, 1].map((index) => [tx.getOutputAddress(index), tx.getOutput(index).amount]))
  assert.equal(outputs.get(recipient.addresses.bitcoin), 50_000n)
  assert.ok(outputs.get(source.addresses.bitcoin) > 0n)
  assert.equal(100_000n - tx.getOutput(0).amount - tx.getOutput(1).amount, BigInt(Math.round(Number(review.fee) * 1e8)))
})

test('signs XRP payments with the required tag, ledger deadline and reserve check', async () => {
  const id = 'xrp-main'
  const quote = (amount, tag) => quoteTransfer(networks[id], endpoint(id), source.addresses, recipient.addresses.xrp, amount, signal, undefined, tag)
  await assert.rejects(quote('2', ''), /requires a destination tag/)
  await assert.rejects(quote('24.5', '0'), /account reserve/)
  const review = await quote('2', '0')
  const tx = await signAndConfirm(review)
  assert.equal(tx.Destination, recipient.addresses.xrp)
  assert.equal(tx.DestinationTag, 0)
  assert.equal(tx.Amount, '2000000')
  assert.equal(tx.LastLedgerSequence, 1010)
})

test('signs SOL and SPL payments and accounts for recipient ATA rent', async () => {
  const id = 'solana-main'
  const quote = (asset) => quoteTransfer(networks[id], endpoint(id), source.addresses, recipient.addresses.solana, '1.25', signal, asset)
  const native = await signAndConfirm(await quote())
  assert.equal(native.instructions.length, 1)
  const review = await quote('solana-main:USDC')
  assert.equal(review.rent, '0.00203928')
  const token = await signAndConfirm(review)
  assert.equal(token.instructions.length, 2)
  assert.equal(token.instructions[1].data[0], 12)
  assert.equal(new DataView(token.instructions[1].data.buffer, token.instructions[1].data.byteOffset).getBigUint64(1, true), 1_250_000n)
})

test('reviews swaps, signs with a slippage floor and asks separately for exact allowance', async () => {
  for (const id of ['ethereum-main', 'base-main']) {
    const token = `${id}:USDC`
    const quote = (sell, buy, slippage = 100) => quoteSwap(networks[id], endpoint(id), source.addresses.ethereum, sell, buy, '1', signal, slippage)
    await assert.rejects(quote(id, id), /two different assets/)
    const buy = await quote(id, token)
    assert.equal(buy.kind, 'swap')
    assert.equal(buy.receive.minimum, '1.98')
    // The mock pool pays a flat amount, so the trade moves the price a lot and Auto widens to 2%.
    const auto = await quote(id, token, 0)
    assert.equal(auto.receive.auto, true)
    assert.equal(auto.receive.minimum, '1.96')
    const buyTx = await signAndConfirm(buy)
    const trade = decodeFunctionData({ abi: contracts, data: buyTx.data })
    assert.equal(trade.functionName, 'swapExactETHForTokens')
    assert.equal(trade.args[0], 1_980_000n)
    assert.equal(trade.args[2].toLowerCase(), source.addresses.ethereum.toLowerCase())
    const permission = await quote(token, id)
    assert.equal(permission.kind, 'approval')
    const approval = decodeFunctionData({ abi: erc20Abi, data: (await signAndConfirm(permission)).data })
    assert.equal(approval.functionName, 'approve')
    assert.equal(approval.args[0].toLowerCase(), permission.to.toLowerCase())
    assert.equal(approval.args[1], 1_000_000n)
    allowance = 1_000_000n
    const sell = await quote(token, id)
    assert.equal(sell.kind, 'swap')
    const sellTx = decodeFunctionData({ abi: contracts, data: (await signAndConfirm(sell)).data })
    assert.equal(sellTx.functionName, 'swapExactTokensForETH')
    allowance = 0n
  }
})

test('stores activity encrypted and moves old plain history into the encrypted form', async () => {
  const store = new Map()
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) }
  const { activitySaved, forgetActivity, loadActivity, readActivity, saveActivity } = await import('../src/storage.ts')
  const item = { hash: 'abc', network: 'ethereum-main', to: '0xRecipient', value: '1.5', created: 1, status: 'submitted' }
  store.set('still.activity.v1.w', JSON.stringify([item]))
  assert.deepEqual(await loadActivity('w', source.activityKey), [item])
  await activitySaved()
  assert.ok(!store.get('still.activity.v1.w').includes('0xRecipient'))
  saveActivity('w', { ...item, hash: 'def', created: 2 })
  await activitySaved()
  forgetActivity()
  assert.deepEqual(readActivity('w'), [])
  assert.deepEqual((await loadActivity('w', source.activityKey)).map((entry) => entry.hash), ['def', 'abc'])
  // A full history is far past the argument limit of one fromCharCode call.
  for (let index = 0; index < 200; index++) saveActivity('w', { ...item, hash: `${index}`.padEnd(900, 'x'), created: 3 + index })
  await activitySaved()
  forgetActivity()
  assert.equal((await loadActivity('w', source.activityKey)).length, 200)
  const stranger = await accountSession({ vault: 'other', root: newPhrase() }, 0)
  assert.deepEqual(await loadActivity('w', stranger.activityKey), [])
})
