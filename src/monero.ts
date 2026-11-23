import { ed25519 } from '@noble/curves/ed25519.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { base58xmr } from '@scure/base'

const order = ed25519.Point.Fn.ORDER
const prefixes = { standard: 18, integrated: 19, subaddress: 42 }

const toNumber = (bytes: Uint8Array) => bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n)
function toBytes(value: bigint) {
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index++, value >>= 8n) bytes[index] = Number(value & 0xffn)
  return bytes
}
const reduce = (bytes: Uint8Array) => toBytes(toNumber(bytes) % order)
export const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** Spend key from the SLIP-10 key at m/44'/128'/account' (same scheme as Trezor), view key = H(spend). */
export function moneroKeys(seed: Uint8Array) {
  const spend = reduce(seed)
  const view = reduce(keccak_256(spend))
  const point = (key: Uint8Array) => ed25519.Point.BASE.multiply(toNumber(key)).toBytes()
  const body = new Uint8Array([prefixes.standard, ...point(spend), ...point(view)])
  return { spend: toHex(spend), view: toHex(view), address: base58xmr.encode(new Uint8Array([...body, ...keccak_256(body).subarray(0, 4)])) }
}

/** Mainnet standard, subaddress or integrated address with a valid checksum and keys. */
export function validMoneroAddress(address: string) {
  let bytes: Uint8Array
  try { bytes = base58xmr.decode(address) } catch { return false }
  const kind = bytes.length === 69 ? [prefixes.standard, prefixes.subaddress] : bytes.length === 77 ? [prefixes.integrated] : []
  if (!kind.includes(bytes[0])) return false
  const body = bytes.subarray(0, -4)
  if (keccak_256(body).subarray(0, 4).some((byte, index) => byte !== bytes[bytes.length - 4 + index])) return false
  try { ed25519.Point.fromBytes(body.subarray(1, 33)); ed25519.Point.fromBytes(body.subarray(33, 65)); return true } catch { return false }
}
