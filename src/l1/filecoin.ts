import { base32nopad, base64 } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { concat, notOwn, sameWallet, type Fetcher } from './common'
import { l1PrivateKey } from './keys'
import { cbor } from './cardano'

const lower = (bytes: Uint8Array) => base32nopad.encode(bytes).toLowerCase()
const checksum = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 4 })
function leb128(value: bigint) {
  const out: number[] = []
  let rest = value
  do { let byte = Number(rest & 0x7fn); rest >>= 7n; if (rest) byte |= 0x80; out.push(byte) } while (rest)
  return Uint8Array.from(out)
}

export function filecoinAddress(publicKey: Uint8Array) {
  const payload = blake2b(secp256k1.Point.fromBytes(publicKey).toBytes(false), { dkLen: 20 })
  return 'f1' + lower(concat(payload, checksum(concat([1], payload))))
}

/** Address bytes for f0 (ID), f1 (secp256k1), f2 (actor), f3 (BLS) and f410 (Ethereum) addresses. */
export function filecoinBytes(address: string) {
  const value = address.trim().toLowerCase()
  const fail = () => { throw new Error('Enter a valid Filecoin address (f1…, f3…, f410… or f0…).') }
  if (!/^f[0-4]/.test(value)) fail()
  const protocol = Number(value[1])
  if (protocol === 0) {
    if (!/^f0\d{1,20}$/.test(value)) fail()
    return concat([0], leb128(BigInt(value.slice(2))))
  }
  let head: Uint8Array = Uint8Array.of(protocol)
  let body = value.slice(2)
  if (protocol === 4) {
    const match = /^(\d{1,10})f([a-z2-7]+)$/.exec(body)
    if (!match) fail()
    head = concat([4], leb128(BigInt(match![1])))
    body = match![2]
  }
  let decoded: Uint8Array
  try { decoded = base32nopad.decode(body.toUpperCase()) } catch { return fail() }
  const payload = decoded.subarray(0, -4)
  const expected = protocol === 3 ? 48 : 20
  if (payload.length !== expected || checksum(concat(head, payload)).some((byte, index) => byte !== decoded[decoded.length - 4 + index])) fail()
  return concat(head, payload)
}

const bigintBytes = (value: bigint) => value === 0n ? new Uint8Array() : concat([0], Uint8Array.from(value.toString(16).padStart(Math.ceil(value.toString(16).length / 2) * 2, '0').match(/../g)!.map((pair) => parseInt(pair, 16))))
const cid = (bytes: Uint8Array) => concat([0x01, 0x71, 0xa0, 0xe4, 0x02, 0x20], blake2b(bytes, { dkLen: 32 }))

export type Message = { to: string; from: string; nonce: number; value: bigint; gasLimit: number; gasFeeCap: bigint; gasPremium: bigint }

export function filecoinMessage(message: Message) {
  return cbor([0, filecoinBytes(message.to), filecoinBytes(message.from), message.nonce, bigintBytes(message.value), message.gasLimit,
    bigintBytes(message.gasFeeCap), bigintBytes(message.gasPremium), 0, new Uint8Array()])
}

export function filecoinSign(message: Message, key: Uint8Array) {
  const bytes = filecoinMessage(message)
  const signature = secp256k1.Signature.fromBytes(secp256k1.sign(blake2b(cid(bytes), { dkLen: 32 }), key, { prehash: false, format: 'recovered' }), 'recovered')
  const data = concat(signature.toBytes('compact'), [signature.recovery!])
  // Secp256k1 messages are tracked by the signed message's CID.
  const signedCid = cid(concat([0x82], bytes, cbor(concat([1], data))))
  return { data, cid: 'b' + lower(signedCid) }
}

async function lotus<T>(endpoint: string, method: string, params: unknown[], fetcher: Fetcher) {
  const response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: `Filecoin.${method}`, params }) })
  if (!response.ok) throw new Error('The Filecoin node returned an unsuccessful response.')
  return await response.json() as { result?: T; error?: { message?: string } }
}

const json = (message: Message) => ({
  Version: 0, To: message.to, From: message.from, Nonce: message.nonce, Value: message.value.toString(), GasLimit: message.gasLimit,
  GasFeeCap: message.gasFeeCap.toString(), GasPremium: message.gasPremium.toString(), Method: 0, Params: null,
})

export async function checkFilecoin(endpoint: string, fetcher: Fetcher) {
  if ((await lotus<string>(endpoint, 'StateNetworkName', [], fetcher)).result !== 'mainnet') throw new Error('The RPC endpoint is connected to a different network.')
}

export async function filecoinBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  const reply = await lotus<string>(endpoint, 'WalletBalance', [owner], fetcher)
  if (typeof reply.result !== 'string') throw new Error('The Filecoin node could not load the balance.')
  return BigInt(reply.result)
}

export async function quoteFilecoin(network: Network, endpoint: string, from: string, recipient: string, amount: string, fetcher: Fetcher): Promise<Quote> {
  filecoinBytes(recipient)
  const to = recipient.trim().toLowerCase()
  notOwn(from, to)
  const value = parseAmount(amount, 18)
  const [balance, nonce] = await Promise.all([filecoinBalance(endpoint, from, fetcher), lotus<number>(endpoint, 'MpoolGetNonce', [from], fetcher)])
  if (typeof nonce.result !== 'number') throw new Error('Insufficient FIL. Receive some FIL first to activate this address.')
  const draft: Message = { to, from, nonce: nonce.result, value, gasLimit: 0, gasFeeCap: 0n, gasPremium: 0n }
  const estimate = await lotus<{ GasLimit?: number; GasFeeCap?: string; GasPremium?: string }>(endpoint, 'GasEstimateMessageGas', [json(draft), { MaxFee: '0' }, null], fetcher)
  const gas = estimate.result
  if (!gas?.GasLimit || !gas.GasFeeCap || !gas.GasPremium) throw new Error(estimate.error?.message?.includes('not found') ? 'Insufficient FIL. Receive some FIL first to activate this address.' : 'Filecoin network fees are currently unavailable.')
  const message: Message = { ...draft, gasLimit: gas.GasLimit, gasFeeCap: BigInt(gas.GasFeeCap), gasPremium: BigInt(gas.GasPremium) }
  const fee = BigInt(message.gasLimit) * message.gasFeeCap
  if (balance < value + fee) throw new Error('Insufficient FIL to cover the amount and network fee.')
  const expires = Date.now() + 60_000
  return {
    to, value: formatAmount(value, 18), fee: formatAmount(fee, 18), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'filecoin')
      try {
        sameWallet(from, filecoinAddress(secp256k1.getPublicKey(key, true)))
        const signed = filecoinSign(message, key)
        return { hash: signed.cid, async broadcast() {
          const reply = await lotus<{ '/'?: string }>(endpoint, 'MpoolPush', [{ Message: json(message), Signature: { Type: 1, Data: base64.encode(signed.data) } }], fetcher)
          if (reply.result?.['/'] !== signed.cid) throw new Error(reply.error?.message ? `Filecoin rejected the transfer: ${reply.error.message.slice(0, 120)}` : 'Filecoin submission is unverified.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function filecoinStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^bafy2bza[a-z2-7]{50,60}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const reply = await lotus<{ Receipt?: { ExitCode?: number } } | null>(endpoint, 'StateSearchMsg', [null, { '/': item.hash }, 20, true], fetcher)
  const receipt = reply.result?.Receipt
  if (!receipt) return item.status
  return receipt.ExitCode === 0 ? 'confirmed' : 'failed'
}
