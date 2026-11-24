import { mnemonicToSeed } from '@scure/bip39'
import { HDKey } from '@scure/bip32'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'

const hardened = 0x80000000

/** SLIP-0010 ed25519 private key along hardened indexes. */
export function slip10(seed: Uint8Array, indexes: number[]) {
  let node = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed)
  for (const index of indexes) {
    const data = new Uint8Array(37)
    data.set(node.subarray(0, 32), 1)
    new DataView(data.buffer).setUint32(33, (index | hardened) >>> 0)
    const child = hmac(sha512, node.subarray(32), data)
    node.fill(0)
    data.fill(0)
    node = child
  }
  const key = node.slice(0, 32)
  node.fill(0)
  return key
}

/** Key paths per chain. ed25519 chains use SLIP-0010 (all hardened), secp256k1 chains use BIP-32. */
export const l1Paths = {
  stellar: { curve: 'ed25519', path: (account: number) => [44, 148, account] },
  near: { curve: 'ed25519', path: (account: number) => [44, 397, account] },
  multiversx: { curve: 'ed25519', path: (account: number) => [44, 508, 0, 0, account] },
  algorand: { curve: 'ed25519', path: (account: number) => [44, 283, account, 0, 0] },
  ton: { curve: 'ed25519', path: (account: number) => [44, 607, account] },
  tezos: { curve: 'ed25519', path: (account: number) => [44, 1729, account, 0] },
  cosmos: { curve: 'secp256k1', path: (account: number) => `m/44'/118'/${account}'/0/0` },
  celestia: { curve: 'secp256k1', path: (account: number) => `m/44'/118'/${account}'/0/0` },
  axelar: { curve: 'secp256k1', path: (account: number) => `m/44'/118'/${account}'/0/0` },
  kava: { curve: 'secp256k1', path: (account: number) => `m/44'/459'/${account}'/0/0` },
  stacks: { curve: 'secp256k1', path: (account: number) => `m/44'/5757'/0'/0/${account}` },
  filecoin: { curve: 'secp256k1', path: (account: number) => `m/44'/461'/0'/0/${account}` },
  injective: { curve: 'secp256k1', path: (account: number) => `m/44'/60'/0'/0/${account}` },
} as const
export type L1Chain = keyof typeof l1Paths

function privateKey(seed: Uint8Array, chain: L1Chain, account: number) {
  const entry = l1Paths[chain]
  if (entry.curve === 'ed25519') return slip10(seed, entry.path(account))
  const root = HDKey.fromMasterSeed(seed)
  const node = root.derive(entry.path(account))
  root.wipePrivateData()
  if (!node.privateKey) throw new Error('Key derivation failed.')
  const key = node.privateKey.slice()
  node.wipePrivateData()
  return key
}

/** Public keys for every chain here from one seed. */
export async function l1PublicKeys(phrase: string, account: number) {
  const seed = await mnemonicToSeed(phrase)
  try {
    const result = {} as Record<L1Chain, Uint8Array>
    for (const chain of Object.keys(l1Paths) as L1Chain[]) {
      const key = privateKey(seed, chain, account)
      try {
        result[chain] = l1Paths[chain].curve === 'ed25519' ? ed25519.getPublicKey(key) : (await import('@noble/curves/secp256k1.js')).secp256k1.getPublicKey(key, true)
      } finally { key.fill(0) }
    }
    return result
  } finally { seed.fill(0) }
}

/** The signing key for one chain. Callers wipe it after use. */
export async function l1PrivateKey(phrase: string, account: number, chain: L1Chain) {
  const seed = await mnemonicToSeed(phrase)
  try { return privateKey(seed, chain, account) } finally { seed.fill(0) }
}
