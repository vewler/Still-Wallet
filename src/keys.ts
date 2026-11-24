import { HDKey } from '@scure/bip32'
import { mnemonicToSeed } from '@scure/bip39'
import { base58check, base58xrp, bech32 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'

const hash160 = (data: Uint8Array) => ripemd160(sha256(data))

/** Derives a secp256k1 key along a BIP-32 path from the recovery phrase's seed. */
async function derive(phrase: string, path: string) {
  const seed = await mnemonicToSeed(phrase)
  try {
    const node = HDKey.fromMasterSeed(seed).derive(path)
    if (!node.publicKey) throw new Error('Key derivation failed.')
    return node
  } finally {
    seed.fill(0)
  }
}

export const keyPaths = {
  bitcoin: (account: number) => `m/84'/0'/${account}'/0/0`,
  xrp: (account: number) => `m/44'/144'/${account}'/0/0`,
  litecoin: (account: number) => `m/84'/2'/${account}'/0/0`,
  dogecoin: (account: number) => `m/44'/3'/${account}'/0/0`,
  tron: (account: number) => `m/44'/195'/${account}'/0/0`,
  bitcoincash: (account: number) => `m/44'/145'/${account}'/0/0`,
  dash: (account: number) => `m/44'/5'/${account}'/0/0`,
  zcash: (account: number) => `m/44'/133'/${account}'/0/0`,
  kaspa: (account: number) => `m/44'/111111'/${account}'/0/0`,
}

/** Public keys for several paths from one seed (the seed is slow to compute). Private parts are wiped. */
export async function publicKeys(phrase: string, account: number) {
  const seed = await mnemonicToSeed(phrase)
  try {
    const root = HDKey.fromMasterSeed(seed)
    const result = {} as Record<keyof typeof keyPaths, Uint8Array>
    for (const [name, path] of Object.entries(keyPaths)) {
      const node = root.derive(path(account))
      if (!node.publicKey) throw new Error('Key derivation failed.')
      result[name as keyof typeof keyPaths] = node.publicKey
      node.wipePrivateData()
    }
    root.wipePrivateData()
    return result
  } finally {
    seed.fill(0)
  }
}

/** Native SegWit (BIP-84) Bitcoin address: m/84'/0'/account'/0/0, the default in most Bitcoin wallets. */
export async function bitcoinKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.bitcoin(account))
}

export function bitcoinAddress(publicKey: Uint8Array) {
  return bech32.encode('bc', [0, ...bech32.toWords(hash160(publicKey))])
}

/** XRP Ledger key: m/44'/144'/account'/0/0, the path Xaman and Ledger use. */
export async function xrpKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.xrp(account))
}

export function xrpAddress(publicKey: Uint8Array) {
  const payload = new Uint8Array([0, ...hash160(publicKey)])
  const checksum = sha256(sha256(payload)).slice(0, 4)
  return base58xrp.encode(new Uint8Array([...payload, ...checksum]))
}

/** Litecoin native SegWit (BIP-84): m/84'/2'/account'/0/0, ltc1 addresses like Litewallet and Ledger. */
export async function litecoinKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.litecoin(account))
}

export function litecoinAddress(publicKey: Uint8Array) {
  return bech32.encode('ltc', [0, ...bech32.toWords(hash160(publicKey))])
}

/** Dogecoin legacy (BIP-44): m/44'/3'/account'/0/0, D… addresses. Dogecoin has no SegWit. */
export async function dogecoinKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.dogecoin(account))
}

const base58sha = base58check(sha256)

export function dogecoinAddress(publicKey: Uint8Array) {
  return base58sha.encode(new Uint8Array([0x1e, ...hash160(publicKey)]))
}

/** Tron (BIP-44): m/44'/195'/account'/0/0, the TronLink and Ledger path. */
export async function tronKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.tron(account))
}

/** 21 bytes: 0x41 + the last 20 bytes of keccak(uncompressed key). */
export function tronAddressBytes(publicKey: Uint8Array) {
  const full = secp256k1.Point.fromBytes(publicKey).toBytes(false)
  return new Uint8Array([0x41, ...keccak_256(full.subarray(1)).subarray(12)])
}

export function tronAddress(publicKey: Uint8Array) {
  return base58sha.encode(tronAddressBytes(publicKey))
}

/** Decodes a T… address to its 21 bytes, or throws. */
export function tronDecode(value: string) {
  const bytes = base58sha.decode(value)
  if (bytes.length !== 21 || bytes[0] !== 0x41) throw new Error('Not a Tron address.')
  return bytes
}

export function tronEncode(bytes: Uint8Array) {
  return base58sha.encode(bytes)
}


/** Bitcoin Cash (BIP-44): m/44'/145'/account'/0/0, the Electron Cash and Ledger path. */
export async function bitcoinCashKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.bitcoincash(account))
}

/** Dash (BIP-44): m/44'/5'/account'/0/0, X… addresses. */
export async function dashKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.dash(account))
}

/** Zcash transparent (BIP-44): m/44'/133'/account'/0/0, t1… addresses. */
export async function zcashKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.zcash(account))
}

/** Kaspa (BIP-44): m/44'/111111'/account'/0/0, the Kaspium and Kaspa NG path. */
export async function kaspaKey(phrase: string, account = 0) {
  return derive(phrase, keyPaths.kaspa(account))
}

const cashCharset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function cashPolymod(values: number[]) {
  const generators = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]
  let c = 1n
  for (const value of values) {
    const top = c >> 35n
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(value)
    generators.forEach((generator, bit) => { if ((top >> BigInt(bit)) & 1n) c ^= generator })
  }
  return c ^ 1n
}

const prefixWords = (prefix: string) => [...prefix].map((char) => char.charCodeAt(0) & 0x1f)

/** CashAddr (Bitcoin Cash) and Kaspa addresses share this format: prefix, version byte, hash, 40-bit checksum. */
export function cashEncode(prefix: string, version: number, hash: Uint8Array) {
  const words = bech32.toWords(new Uint8Array([version, ...hash]))
  const checksum = cashPolymod([...prefixWords(prefix), 0, ...words, 0, 0, 0, 0, 0, 0, 0, 0])
  const tail = Array.from({ length: 8 }, (_, index) => Number((checksum >> BigInt(5 * (7 - index))) & 31n))
  return `${prefix}:${[...words, ...tail].map((word) => cashCharset[word]).join('')}`
}

/** Decodes `prefix:payload` (the prefix may be left out). Returns the version byte and hash, or throws. */
export function cashDecode(prefix: string, value: string) {
  const text = value.trim()
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) throw new Error('Mixed case address.')
  const lower = text.toLowerCase()
  const body = lower.startsWith(`${prefix}:`) ? lower.slice(prefix.length + 1) : lower
  if (body.includes(':') || body.length < 9) throw new Error('Invalid address.')
  const words = [...body].map((char) => {
    const index = cashCharset.indexOf(char)
    if (index === -1) throw new Error('Invalid address.')
    return index
  })
  if (cashPolymod([...prefixWords(prefix), 0, ...words]) !== 0n) throw new Error('Invalid address checksum.')
  const bytes = bech32.fromWords(words.slice(0, -8))
  return { version: bytes[0], hash: Uint8Array.from(bytes.slice(1)) }
}

export function bitcoinCashAddress(publicKey: Uint8Array) {
  return cashEncode('bitcoincash', 0, hash160(publicKey))
}

export function dashAddress(publicKey: Uint8Array) {
  return base58sha.encode(new Uint8Array([0x4c, ...hash160(publicKey)]))
}

export function zcashAddress(publicKey: Uint8Array) {
  return base58sha.encode(new Uint8Array([0x1c, 0xb8, ...hash160(publicKey)]))
}

/** Schnorr (version 0) Kaspa address of the x-only public key. */
export function kaspaAddress(publicKey: Uint8Array) {
  return cashEncode('kaspa', 0, publicKey.subarray(1, 33))
}

export function base58Decode(value: string) {
  return base58sha.decode(value)
}

export { hash160 }
