import { base64urlnopad, hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { formatAmount, parseAmount, type Network } from '../networks'
import type { ActivityItem } from '../storage'
import type { Quote } from '../rpc'
import { base64, concat, fromBase64, notOwn, rest, sameWallet, utf8, type Fetcher } from './common'
import { l1PrivateKey } from './keys'

/** TON wallet v4r2 (the Trust Wallet and Ledger contract), cells and bags of cells written out by hand. */
export class Cell {
  readonly bits: number[]
  readonly refs: Cell[]
  #hash?: Uint8Array
  #depth?: number
  constructor(bits: number[] = [], refs: Cell[] = []) {
    if (bits.length > 1023 || refs.length > 4) throw new Error('Cell overflow.')
    this.bits = bits
    this.refs = refs
  }
  /** Data bytes with the completion tag for partial bytes. */
  data() {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8))
    this.bits.forEach((bit, index) => { if (bit) bytes[index >> 3] |= 0x80 >> (index & 7) })
    if (this.bits.length % 8) bytes[this.bits.length >> 3] |= 0x80 >> (this.bits.length % 8)
    return bytes
  }
  descriptors() {
    return Uint8Array.of(this.refs.length, Math.ceil(this.bits.length / 8) + Math.floor(this.bits.length / 8))
  }
  depth(): number {
    return this.#depth ??= this.refs.length ? Math.max(...this.refs.map((ref) => ref.depth())) + 1 : 0
  }
  hash(): Uint8Array {
    return this.#hash ??= sha256(concat(this.descriptors(), this.data(),
      ...this.refs.map((ref) => [ref.depth() >> 8, ref.depth() & 0xff]), ...this.refs.map((ref) => ref.hash())))
  }
}

export class Builder {
  bits: number[] = []
  refs: Cell[] = []
  uint(value: bigint | number, size: number) {
    const number = BigInt(value)
    if (number < 0n || number >= 1n << BigInt(size)) throw new Error('Value out of range.')
    for (let bit = size - 1; bit >= 0; bit--) this.bits.push(Number((number >> BigInt(bit)) & 1n))
    return this
  }
  bit(value: boolean | number) { this.bits.push(value ? 1 : 0); return this }
  bytes(value: Uint8Array) { for (const byte of value) this.uint(byte, 8); return this }
  ref(cell: Cell) { this.refs.push(cell); return this }
  coins(value: bigint) {
    const size = value ? Math.ceil(value.toString(16).length / 2) : 0
    return this.uint(size, 4).uint(value, size * 8)
  }
  address(target?: TonAddress) {
    if (!target) return this.uint(0, 2)
    return this.uint(0b100, 3).uint(target.workchain & 0xff, 8).bytes(target.hash)
  }
  slice(cell: Cell) { this.bits.push(...cell.bits); this.refs.push(...cell.refs); return this }
  /** Either X ^X: inline when it fits, like @ton/core. */
  either(cell: Cell) {
    return 1023 - this.bits.length - 1 >= cell.bits.length && this.refs.length + cell.refs.length <= 4 ? this.bit(0).slice(cell) : this.bit(1).ref(cell)
  }
  end() { return new Cell(this.bits, this.refs) }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1
  return crc >>> 0
})
function crc32c(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0
  return Uint8Array.of(crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24)
}

/** Single-root bag of cells with a CRC32-C, the format sendBoc takes. */
export function toBoc(root: Cell) {
  const order: Cell[] = []
  const seen = new Map<string, number>()
  const visit = (cell: Cell) => {
    const key = hex.encode(cell.hash())
    if (seen.has(key)) return
    seen.set(key, -1)
    order.push(cell)
    cell.refs.forEach(visit)
  }
  visit(root)
  // Parents before children: sort by depth, deepest (root side) first, stable otherwise.
  const sorted = order.map((cell, index) => ({ cell, index })).sort((left, right) => right.cell.depth() - left.cell.depth() || left.index - right.index).map(({ cell }) => cell)
  sorted.forEach((cell, index) => seen.set(hex.encode(cell.hash()), index))
  const sizeBytes = Math.max(1, Math.ceil(sorted.length.toString(16).length / 2))
  const index = (cell: Cell) => { const value = seen.get(hex.encode(cell.hash()))!; return hex.decode(value.toString(16).padStart(sizeBytes * 2, '0')) }
  const cells = concat(...sorted.map((cell) => concat(cell.descriptors(), cell.data(), ...cell.refs.map(index))))
  const offBytes = Math.max(1, Math.ceil(cells.length.toString(16).length / 2))
  const num = (value: number, size: number) => hex.decode(value.toString(16).padStart(size * 2, '0'))
  const body = concat([0xb5, 0xee, 0x9c, 0x72, 0x40 | sizeBytes, offBytes], num(sorted.length, sizeBytes), num(1, sizeBytes), num(0, sizeBytes), num(cells.length, offBytes), num(0, sizeBytes), cells)
  return concat(body, crc32c(body))
}

export function fromBoc(bytes: Uint8Array) {
  if (hex.encode(bytes.subarray(0, 4)) !== 'b5ee9c72') throw new Error('Not a bag of cells.')
  const flags = bytes[4]
  const size = flags & 7
  const offBytes = bytes[5]
  let position = 6
  const read = (length: number) => { let value = 0; for (let index = 0; index < length; index++) value = value * 256 + bytes[position++]; return value }
  const count = read(size)
  const roots = read(size)
  read(size)
  read(offBytes)
  const rootIndexes = Array.from({ length: roots }, () => read(size))
  if (flags & 0x80) position += count * offBytes
  const raw = Array.from({ length: count }, () => {
    const d1 = bytes[position++]
    const d2 = bytes[position++]
    const data = bytes.subarray(position, position + Math.ceil(d2 / 2))
    position += Math.ceil(d2 / 2)
    const refs = Array.from({ length: d1 & 7 }, () => read(size))
    let length = Math.floor(d2 / 2) * 8
    if (d2 % 2) {
      const last = data[data.length - 1]
      const trailing = last ? Math.log2(last & -last) : 0
      length = (data.length - 1) * 8 + (7 - trailing)
    }
    const bits = Array.from({ length }, (_, index) => (data[index >> 3] >> (7 - (index & 7))) & 1)
    return { bits, refs }
  })
  const built: Cell[] = []
  for (let index = count - 1; index >= 0; index--) built[index] = new Cell(raw[index].bits, raw[index].refs.map((ref) => built[ref]))
  return built[rootIndexes[0]]
}

const walletCode = fromBoc(fromBase64('te6ccgECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVA=='))
const walletId = 698983191
export type TonAddress = { workchain: number; hash: Uint8Array; bounceable?: boolean }

function crc16(bytes: Uint8Array) {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

export function formatTon(address: TonAddress, bounceable = false) {
  const payload = concat([bounceable ? 0x11 : 0x51, address.workchain & 0xff], address.hash)
  const crc = crc16(payload)
  return base64urlnopad.encode(concat(payload, [crc >> 8, crc & 0xff]))
}

export function parseTon(text: string): TonAddress {
  const value = text.trim()
  const raw = /^(-1|0):([a-f\d]{64})$/i.exec(value)
  if (raw) return { workchain: Number(raw[1]), hash: hex.decode(raw[2].toLowerCase()), bounceable: false }
  try {
    const bytes = base64urlnopad.decode(value.replace(/\+/g, '-').replace(/\//g, '_'))
    const crc = crc16(bytes.subarray(0, 34))
    if (bytes.length === 36 && bytes[34] === crc >> 8 && bytes[35] === (crc & 0xff) && (bytes[0] & 0x7f) !== 0 && !(bytes[0] & 0x80) && [0, 0xff].includes(bytes[1]) && [0x11, 0x51].includes(bytes[0])) {
      return { workchain: bytes[1] === 0xff ? -1 : 0, hash: bytes.slice(2, 34), bounceable: bytes[0] === 0x11 }
    }
  } catch { /* Fall through. */ }
  throw new Error('Enter a valid TON mainnet address.')
}

function walletData(publicKey: Uint8Array) {
  return new Builder().uint(0, 32).uint(walletId, 32).bytes(publicKey).bit(0).end()
}

function stateInit(publicKey: Uint8Array) {
  return new Builder().uint(0b00110, 5).ref(walletCode).ref(walletData(publicKey)).end()
}

export function tonWallet(publicKey: Uint8Array): TonAddress {
  return { workchain: 0, hash: stateInit(publicKey).hash() }
}

export function tonAddress(publicKey: Uint8Array) {
  return formatTon(tonWallet(publicKey))
}

function comment(text: string) {
  return new Builder().uint(0, 32).bytes(utf8(text)).end()
}

export function tonTransfer(fields: { publicKey: Uint8Array; seqno: number; validUntil: number; to: TonAddress; bounce: boolean; amount: bigint; memo: string; deploy: boolean }, sign: (hash: Uint8Array) => Uint8Array) {
  const internal = new Builder().bit(0).bit(1).bit(fields.bounce).bit(0).address().address(fields.to).coins(fields.amount).bit(0).coins(0n).coins(0n).uint(0, 64).uint(0, 32).bit(0)
  internal.either(fields.memo ? comment(fields.memo) : new Cell())
  const signing = new Builder().uint(walletId, 32).uint(fields.validUntil, 32).uint(fields.seqno, 32).uint(0, 8).uint(3, 8).ref(internal.end()).end()
  const body = new Builder().bytes(sign(signing.hash())).slice(signing).end()
  const wallet = tonWallet(fields.publicKey)
  const header = () => new Builder().uint(0b10, 2).address().address(wallet).coins(0n)
  const message = header()
  if (fields.deploy) {
    const init = stateInit(fields.publicKey)
    message.bit(1)
    if (1023 - message.bits.length - 2 < init.bits.length + body.bits.length) message.bit(1).ref(init)
    else message.bit(0).slice(init)
  } else message.bit(0)
  message.either(body)
  // TEP-467 normalized hash (no init, body by reference), the id explorers and indexers use.
  const normalized = header().bit(0).bit(1).ref(body).end()
  return { boc: toBoc(message.end()), hash: normalized.hash(), body, init: fields.deploy ? stateInit(fields.publicKey) : undefined }
}

type Info = { ok?: boolean; result?: { balance?: string | number; seqno?: number; account_state?: string; wallet_type?: string } }
const mainnetZerostate = 'F6OpKZKqvqeFp6CQmFomXNMfMj2EnaUSOXN+Mh+wVWk='

async function walletInfo(endpoint: string, address: string, fetcher: Fetcher) {
  const reply = await rest<Info>(endpoint, `/v2/getWalletInformation?address=${address}`, fetcher)
  if (!reply?.ok || !reply.result) throw new Error('The TON provider could not load the wallet.')
  return reply.result
}

export async function checkTon(endpoint: string, fetcher: Fetcher) {
  const reply = await rest<{ result?: { init?: { root_hash?: string } } }>(endpoint, '/v2/getMasterchainInfo', fetcher)
  if (reply?.result?.init?.root_hash !== mainnetZerostate) throw new Error('The RPC endpoint is connected to a different network.')
}

export async function tonBalance(endpoint: string, owner: string, fetcher: Fetcher) {
  return BigInt((await walletInfo(endpoint, owner, fetcher)).balance ?? 0)
}

export async function quoteTon(network: Network, endpoint: string, from: string, recipient: string, amount: string, memo: string, fetcher: Fetcher): Promise<Quote> {
  const target = parseTon(recipient)
  const to = formatTon(target, target.bounceable)
  notOwn(hex.encode(parseTon(from).hash), hex.encode(target.hash))
  if (utf8(memo).length > 120) throw new Error('Keep the comment under 120 bytes.')
  const value = parseAmount(amount, 9)
  const info = await walletInfo(endpoint, from, fetcher)
  const balance = BigInt(info.balance ?? 0)
  const deploy = info.account_state !== 'active'
  if (!deploy && info.wallet_type && info.wallet_type !== 'wallet v4 r2') throw new Error('This TON wallet uses a contract Still doesn’t support.')
  const seqno = deploy ? 0 : Number(info.seqno ?? 0)
  const owner = parseTon(from)
  // Fee test run with a placeholder signature.
  const draft = tonTransfer({ publicKey: new Uint8Array(32), seqno, validUntil: 0, to: target, bounce: Boolean(target.bounceable), amount: value, memo: memo.trim(), deploy }, () => new Uint8Array(64))
  // Deploying the wallet on its first transfer costs a little more and can't be test run without the key.
  const estimate = deploy ? undefined : await rest<{ ok?: boolean; result?: { source_fees?: Record<string, number> } }>(endpoint, '/v2/estimateFee', fetcher, JSON.stringify({ address: from, body: base64(toBoc(draft.body)), ignore_chksig: true }))
  const fees = estimate?.result?.source_fees
  const fee = fees ? BigInt(Object.values(fees).reduce((sum, part) => sum + (Number(part) || 0), 0)) * 12n / 10n : 15_000_000n
  if (balance < value + fee) throw new Error('Insufficient TON to cover the amount and network fee.')
  const expires = Date.now() + 60_000
  const validUntil = Math.floor(Date.now() / 1000) + 180
  return {
    to, value: formatAmount(value, 9), fee: formatAmount(fee, 9), network, expires,
    async sign(session) {
      if (Date.now() > expires) throw new Error('The fee quote expired. Request another quote.')
      const key = await l1PrivateKey(session.mnemonic, session.account, 'ton')
      try {
        const publicKey = ed25519.getPublicKey(key)
        sameWallet(hex.encode(owner.hash), hex.encode(tonWallet(publicKey).hash))
        const signed = tonTransfer({ publicKey, seqno, validUntil, to: target, bounce: Boolean(target.bounceable), amount: value, memo: memo.trim(), deploy }, (hash) => ed25519.sign(hash, key))
        const id = hex.encode(signed.hash)
        return { hash: id, lastLedgerSequence: validUntil, async broadcast() {
          const reply = await rest<{ ok?: boolean; error?: string }>(endpoint, '/v2/sendBoc', fetcher, JSON.stringify({ boc: base64(signed.boc) }))
          if (!reply?.ok) throw new Error(reply?.error ? `TON rejected the transfer: ${reply.error.slice(0, 120)}` : 'TON submission is unverified.')
        } }
      } finally { key.fill(0) }
    },
  }
}

export async function tonStatus(item: ActivityItem, endpoint: string, fetcher: Fetcher): Promise<ActivityItem['status']> {
  if (!/^[a-f\d]{64}$/.test(item.hash)) throw new Error('Invalid transaction ID.')
  const reply = await rest<{ transactions?: { description?: { aborted?: boolean; compute_ph?: { success?: boolean }; action?: { success?: boolean } } }[] }>(endpoint, `/v3/transactionsByMessage?direction=in&msg_hash=${item.hash}`, fetcher)
  const tx = reply?.transactions?.[0]
  if (tx) return tx.description?.aborted || tx.description?.compute_ph?.success === false || tx.description?.action?.success === false ? 'failed' : 'confirmed'
  if (item.lastLedgerSequence && Date.now() / 1000 > item.lastLedgerSequence + 60) return 'expired'
  return item.status
}
