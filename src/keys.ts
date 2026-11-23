import { HDKey } from '@scure/bip32'
import { mnemonicToSeed } from '@scure/bip39'
import { base58xrp, bech32 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'

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

/** Native SegWit (BIP-84) Bitcoin address: m/84'/0'/account'/0/0, the default in most Bitcoin wallets. */
export async function bitcoinKey(phrase: string, account = 0) {
  return derive(phrase, `m/84'/0'/${account}'/0/0`)
}

export function bitcoinAddress(publicKey: Uint8Array) {
  return bech32.encode('bc', [0, ...bech32.toWords(hash160(publicKey))])
}

/** XRP Ledger key: m/44'/144'/account'/0/0, the path Xaman and Ledger use. */
export async function xrpKey(phrase: string, account = 0) {
  return derive(phrase, `m/44'/144'/${account}'/0/0`)
}

export function xrpAddress(publicKey: Uint8Array) {
  const payload = new Uint8Array([0, ...hash160(publicKey)])
  const checksum = sha256(sha256(payload)).slice(0, 4)
  return base58xrp.encode(new Uint8Array([...payload, ...checksum]))
}
