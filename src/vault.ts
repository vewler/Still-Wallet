import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { mnemonicToAccount } from 'viem/accounts'
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit'
import { VAULT_KEY, activeAccount } from './storage'
import type { Addresses } from './networks'
import { bitcoinAddress, bitcoinCashAddress, dashAddress, kaspaAddress, zcashAddress, dogecoinAddress, litecoinAddress, publicKeys, tronAddress, xrpAddress } from './keys'
import { passwordRules } from './passwords'
import { moneroKeys } from './monero'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { l1Addresses } from './l1/index'

const iterations = 600_000
const version = 1
const encoder = new TextEncoder()

type StoredVault = {
  version: 1
  id: string
  salt: string
  iv: string
  data: string
  /** Lets the recovery phrase prove it belongs to this vault, so a forgotten password can be reset. */
  check?: string
}

export type Session = {
  /** Per-wallet key for names and activity; account 0 keeps the bare vault id. */
  id: string
  vault: string
  /** Derivation index. 0 for a wallet with its own phrase. */
  account: number
  /** Place on the Wallets list: 0-99 are accounts of the vault phrase, 100+ wallets with their own phrase. */
  slot: number
  /** This wallet's phrase, the one that signs. */
  mnemonic: string
  /** The vault phrase. Unlocks everything else. */
  root: string
  addresses: Addresses
  /** Encrypts this vault's activity history; derived from the phrase, never stored. */
  activityKey: CryptoKey
}

export function newPhrase() {
  return generateMnemonic(wordlist, 128)
}

export function normalizePhrase(phrase: string) {
  return phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ')
}

export function validPhrase(phrase: string) {
  return validateMnemonic(normalizePhrase(phrase), wordlist)
}

function encode(data: Uint8Array) {
  return btoa(String.fromCharCode(...data))
}

function decode(data: string) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
}

function assertSecure() {
  if (!globalThis.isSecureContext || !crypto.subtle) throw new Error('Open Still on HTTPS or localhost to use a wallet.')
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  assertSecure()
  const bytes = encoder.encode(password)
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } finally {
    bytes.fill(0)
  }
}

async function signHmac(key: Uint8Array<ArrayBuffer>, message: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', material, message))
}

export function evmAccount(phrase: string, account = 0) {
  return mnemonicToAccount(phrase, { path: `m/44'/60'/0'/0/${account}` })
}

/** SLIP-0010 ed25519 key along hardened indexes. */
async function ed25519Key(phrase: string, indexes: number[]) {
  const seed = await mnemonicToSeed(phrase)
  let node: Uint8Array<ArrayBuffer> | undefined
  try {
    node = await signHmac(encoder.encode('ed25519 seed'), new Uint8Array(seed))
    for (const index of indexes) {
      const link = new Uint8Array(37)
      link.set(node.subarray(0, 32), 1)
      new DataView(link.buffer).setUint32(33, index + 0x80000000)
      try {
        const child = await signHmac(node.subarray(32), link)
        node.fill(0)
        node = child
      } finally {
        link.fill(0)
      }
    }
    return node.slice(0, 32)
  } finally {
    seed.fill(0)
    node?.fill(0)
  }
}

export async function solanaKeypair(phrase: string, account = 0) {
  const key = await ed25519Key(phrase, [44, 501, account, 0])
  try { return await createKeyPairSignerFromPrivateKeyBytes(key) } finally { key.fill(0) }
}

/** Monero m/44'/128'/account', Trezor's path. */
export async function moneroWallet(phrase: string, account = 0) {
  const key = await ed25519Key(phrase, [44, 128, account])
  try { return moneroKeys(key) } finally { key.fill(0) }
}

/** Sui m/44'/784'/account'/0'/0', the Sui Wallet and Slush path. Returns the 32-byte ed25519 secret. */
export function suiKey(phrase: string, account = 0) {
  return ed25519Key(phrase, [44, 784, account, 0, 0])
}

/** Aptos m/44'/637'/account'/0'/0', the Petra path. */
export function aptosKey(phrase: string, account = 0) {
  return ed25519Key(phrase, [44, 637, account, 0, 0])
}

/** 0x + blake2b-256(flag 0x00 + public key). */
export function suiAddress(publicKey: Uint8Array) {
  return '0x' + bytesToHex(blake2b(Uint8Array.from([0, ...publicKey]), { dkLen: 32 }))
}

/** 0x + sha3-256(public key + scheme 0x00). */
export function aptosAddress(publicKey: Uint8Array) {
  return '0x' + bytesToHex(sha3_256(Uint8Array.from([...publicKey, 0])))
}

async function ed25519Public(secret: Promise<Uint8Array>) {
  const key = await secret
  try { return ed25519.getPublicKey(key) } finally { key.fill(0) }
}

async function deriveActivityKey(mnemonic: string, vault: string) {
  const bytes = encoder.encode(mnemonic)
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(vault), info: encoder.encode('still/activity/1') },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally {
    bytes.fill(0)
  }
}

export async function sessionFor(vault: string, mnemonic: string, account = 0, root = mnemonic, slot = account): Promise<Session> {
  if (!Number.isInteger(account) || account < 0 || account >= 100) throw new Error('Invalid wallet.')
  const ethereum = evmAccount(mnemonic, account).address
  const [solanaKey, keys, xmr, activityKey, sui, aptos, l1] = await Promise.all([
    solanaKeypair(mnemonic, account), publicKeys(mnemonic, account), moneroWallet(mnemonic, account), deriveActivityKey(root, vault),
    ed25519Public(suiKey(mnemonic, account)), ed25519Public(aptosKey(mnemonic, account)), l1Addresses(mnemonic, account),
  ])
  const addresses = {
    ethereum, solana: solanaKey.address, bitcoin: bitcoinAddress(keys.bitcoin), xrp: xrpAddress(keys.xrp), monero: xmr.address,
    litecoin: litecoinAddress(keys.litecoin), dogecoin: dogecoinAddress(keys.dogecoin), tron: tronAddress(keys.tron),
    sui: suiAddress(sui), aptos: aptosAddress(aptos), aptosPublicKey: bytesToHex(aptos), ...l1,
    bitcoincash: bitcoinCashAddress(keys.bitcoincash), dash: dashAddress(keys.dash), zcash: zcashAddress(keys.zcash), kaspa: kaspaAddress(keys.kaspa),
  }
  return { id: slot ? `${vault}:${slot}` : vault, vault, account, slot, mnemonic, root, addresses, activityKey }
}

/* Wallets added with their own phrase. Encrypted with a key from the vault phrase, so password changes, resets and Face ID cover them too. */
const PHRASES_KEY = 'still.phrases.v1'
export const firstOwnPhraseSlot = 100

async function phrasesKey(root: string, vault: string) {
  const bytes = encoder.encode(root)
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(vault), info: encoder.encode('still/phrases/1') },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally {
    bytes.fill(0)
  }
}

const phrasesData = (vault: string) => encoder.encode(`still/phrases/1/${vault}`)

async function readPhrases(vault: string, root: string): Promise<Record<number, string>> {
  let stored: { vault?: string; iv?: string; data?: string } | null = null
  try { stored = JSON.parse(localStorage.getItem(PHRASES_KEY) ?? 'null') } catch { /* Treated as none. */ }
  if (!stored || stored.vault !== vault || !stored.iv || !stored.data) return {}
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(stored.iv), additionalData: phrasesData(vault) }, await phrasesKey(root, vault), decode(stored.data)))
  try { return JSON.parse(new TextDecoder().decode(plain)) } finally { plain.fill(0) }
}

async function savePhrases(vault: string, root: string, phrases: Record<number, string>) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = encoder.encode(JSON.stringify(phrases))
  try {
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: phrasesData(vault) }, await phrasesKey(root, vault), plain))
    localStorage.setItem(PHRASES_KEY, JSON.stringify({ vault, iv: encode(iv), data: encode(data) }))
  } finally {
    plain.fill(0)
  }
}

/** Session for a place on the Wallets list. On unlock a missing phrase falls back to the first wallet instead of locking you out. */
async function walletSession(vault: string, root: string, slot: number, fallback = false): Promise<Session> {
  if (slot < firstOwnPhraseSlot) return sessionFor(vault, root, slot, root, slot)
  const phrase = await readPhrases(vault, root).then((phrases) => phrases[slot], () => undefined)
  if (phrase && validPhrase(phrase)) return sessionFor(vault, phrase, 0, root, slot)
  if (fallback) return sessionFor(vault, root, 0)
  throw new Error('Still could not open this wallet.')
}

/** Open another wallet from the unlocked vault, no password needed. */
export function accountSession(session: Session, slot: number) {
  return walletSession(session.vault, session.root, slot)
}

/** The phrase and derivation index behind a place on the Wallets list, so the keys can be made off the main thread. */
export async function walletSource(session: Session, slot: number) {
  if (slot < firstOwnPhraseSlot) return { mnemonic: session.root, account: slot }
  const phrase = await readPhrases(session.vault, session.root).then((phrases) => phrases[slot], () => undefined)
  if (phrase && validPhrase(phrase)) return { mnemonic: phrase, account: 0 }
  throw new Error('Still could not open this wallet.')
}

/** Save a wallet with its own phrase in a free slot. */
export async function addOwnPhrase(session: Session, phrase: string, slot: number) {
  assertSecure()
  const mnemonic = normalizePhrase(phrase)
  if (!validPhrase(mnemonic)) throw new Error('Enter a valid English BIP-39 recovery phrase.')
  if (!Number.isInteger(slot) || slot < firstOwnPhraseSlot || slot >= firstOwnPhraseSlot + 100) throw new Error('You can add up to 100 wallets.')
  const phrases = await readPhrases(session.vault, session.root)
  if (mnemonic === session.root || Object.values(phrases).includes(mnemonic)) throw new Error('This recovery phrase is already in Still Wallet.')
  await savePhrases(session.vault, session.root, { ...phrases, [slot]: mnemonic })
}

/** Drop a deleted wallet's own phrase from this device. */
export async function removeOwnPhrase(session: Session, slot: number) {
  const phrases = await readPhrases(session.vault, session.root)
  if (!(slot in phrases)) return
  delete phrases[slot]
  await savePhrases(session.vault, session.root, phrases)
}

function associatedData(id: string) {
  return encoder.encode(`still/vault/${version}/${id}`)
}

/** One-way tag from the phrase and vault id. Only someone with the phrase can make it. */
async function phraseCheck(mnemonic: string, id: string) {
  const bytes = encoder.encode(mnemonic)
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits'])
    return encode(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(id), info: encoder.encode('still/vault-check/1') }, material, 256)))
  } finally {
    bytes.fill(0)
  }
}

/** Older vaults get their check once opened. Skipped if the saved vault changed meanwhile. */
async function addPhraseCheck(raw: string, mnemonic: string) {
  try {
    const vault = JSON.parse(raw) as StoredVault
    if (vault.check) return
    const check = await phraseCheck(mnemonic, vault.id)
    const save = () => { if (localStorage.getItem(VAULT_KEY) === raw) localStorage.setItem(VAULT_KEY, JSON.stringify({ ...vault, check })) }
    if (navigator.locks) await navigator.locks.request(VAULT_KEY, save)
    else save()
  } catch { /* Best effort, tried again next unlock. */ }
}

function readVault() {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('No wallet is saved in this browser.')
  const vault = JSON.parse(raw) as StoredVault
  if (vault.version !== version || !/^[\da-f-]{36}$/i.test(vault.id)) throw new Error('Unsupported vault.')
  return { raw, vault }
}

/** Does this phrase belong to the saved wallet? Uses the vault check, or for older vaults the encrypted contacts and history. */
async function phraseMatches(mnemonic: string, vault: StoredVault) {
  if (vault.check) {
    const check = await phraseCheck(mnemonic, vault.id)
    return check.length === vault.check.length && [...check].every((character, index) => character === vault.check![index])
  }
  const { opensSavedData } = await import('./storage')
  const opens = await opensSavedData(vault.id, await deriveActivityKey(mnemonic, vault.id))
  if (opens === undefined) throw new Error('Still can’t check this phrase on this device yet. Delete the wallet and import it again instead.')
  return opens
}

/** Step 1 of a password reset: is the phrase valid and the one of this wallet. */
export async function checkRecoveryPhrase(phrase: string) {
  assertSecure()
  const mnemonic = normalizePhrase(phrase)
  if (!validPhrase(mnemonic)) throw new Error('Enter a valid English BIP-39 recovery phrase.')
  if (!(await phraseMatches(mnemonic, readVault().vault))) throw new Error('This recovery phrase doesn’t match this wallet.')
}

/** Forgot password: the phrase proves ownership, then the vault is encrypted again with a new password. Same id, so names, contacts, activity and settings stay. */
export async function resetPassword(phrase: string, next: string) {
  assertSecure()
  const missing = passwordRules.filter((rule) => !rule.test(next))
  if (missing.length) throw new Error('Your new password doesn’t meet all the requirements yet.')
  if (next.length > 256) throw new Error('Use a password of at most 256 characters.')
  const mnemonic = normalizePhrase(phrase)
  if (!validPhrase(mnemonic)) throw new Error('Enter a valid English BIP-39 recovery phrase.')
  const { raw, vault } = readVault()
  if (!(await phraseMatches(mnemonic, vault))) throw new Error('This recovery phrase doesn’t match this wallet.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const [key, check] = await Promise.all([deriveKey(next, salt), phraseCheck(mnemonic, vault.id)])
  const plaintext = encoder.encode(mnemonic)
  try {
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(vault.id) }, key, plaintext))
    const updated: StoredVault = { version, id: vault.id, salt: encode(salt), iv: encode(iv), data: encode(data), check }
    const save = () => {
      if (localStorage.getItem(VAULT_KEY) !== raw) throw new Error('The saved wallet changed. Try again.')
      localStorage.setItem(VAULT_KEY, JSON.stringify(updated))
    }
    if (navigator.locks) await navigator.locks.request(VAULT_KEY, save)
    else save()
  } finally {
    plaintext.fill(0)
  }
  return walletSession(vault.id, mnemonic, activeAccount(vault.id), true)
}


export async function createVault(phrase: string, password: string) {
  assertSecure()
  const mnemonic = normalizePhrase(phrase)
  if (!validPhrase(mnemonic)) throw new Error('Enter a valid English BIP-39 recovery phrase.')
  const missing = passwordRules.filter((rule) => !rule.test(password))
  if (missing.length) throw new Error(`Password needs: ${missing.map((rule) => rule.label.toLowerCase()).join(', ')}.`)
  if (password.length > 256) throw new Error('Use a password of at most 256 characters.')
  const id = crypto.randomUUID()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const [key, session, check] = await Promise.all([deriveKey(password, salt), sessionFor(id, mnemonic), phraseCheck(mnemonic, id)])
  const plaintext = encoder.encode(mnemonic)
  let data: ArrayBuffer
  try {
    data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(id) }, key, plaintext)
  } finally {
    plaintext.fill(0)
  }
  const vault: StoredVault = { version, id, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)), check }
  const save = () => {
    if (localStorage.getItem(VAULT_KEY)) throw new Error('A wallet is already saved in this browser.')
    localStorage.setItem(VAULT_KEY, JSON.stringify(vault))
  }
  if (navigator.locks) await navigator.locks.request(VAULT_KEY, save)
  else save()
  return session
}

export async function unlockVault(password: string) {
  assertSecure()
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('No wallet is saved in this browser.')
  let id = ''
  let phrase = ''
  try {
    const vault = JSON.parse(raw) as StoredVault
    if (vault.version !== version || !/^[\da-f-]{36}$/i.test(vault.id)) throw new Error('Unsupported vault.')
    const salt = decode(vault.salt)
    const iv = decode(vault.iv)
    const data = decode(vault.data)
    if (salt.length !== 16 || iv.length !== 12 || data.length > 512) throw new Error('Invalid vault.')
    const key = await deriveKey(password, salt)
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: associatedData(vault.id) }, key, data))
    try { phrase = new TextDecoder().decode(plaintext) } finally { plaintext.fill(0) }
    if (!validPhrase(phrase)) throw new Error('Invalid vault.')
    id = vault.id
  } catch {
    throw new Error('Incorrect password')
  }
  const session = await walletSession(id, phrase, activeAccount(id), true)
  if (localStorage.getItem(VAULT_KEY) !== raw) throw new Error('The saved wallet changed. Try again.')
  await addPhraseCheck(raw, phrase)
  return session
}

/** Re-encrypt the saved phrase with a new password. The old vault stays in place until the new one is built and checked, then one write swaps it. Same id, so names, activity and Face ID unlock keep working. */
export async function changePassword(vaultId: string, current: string, next: string) {
  assertSecure()
  const missing = passwordRules.filter((rule) => !rule.test(next))
  if (missing.length) throw new Error('Your new password doesn’t meet all the requirements yet.')
  if (next.length > 256) throw new Error('Use a password of at most 256 characters.')
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw) throw new Error('No wallet is saved in this browser.')
  let vault: StoredVault
  let plaintext: Uint8Array<ArrayBuffer> | undefined
  try {
    vault = JSON.parse(raw) as StoredVault
    if (vault.version !== version || vault.id !== vaultId) throw new Error('Invalid vault.')
    const key = await deriveKey(current, decode(vault.salt))
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(vault.iv), additionalData: associatedData(vault.id) }, key, decode(vault.data)))
    if (!validPhrase(new TextDecoder().decode(plaintext))) throw new Error('Invalid vault.')
  } catch {
    plaintext?.fill(0)
    throw new Error('Incorrect password')
  }
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(next, salt)
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(vault.id) }, key, plaintext))
    // Prove the new copy opens before touching the saved one.
    const check = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: associatedData(vault.id) }, key, data))
    const same = check.length === plaintext.length && check.every((byte, index) => byte === plaintext![index])
    check.fill(0)
    if (!same) throw new Error('The password could not be changed. Nothing was changed.')
    const tag = vault.check ?? await phraseCheck(new TextDecoder().decode(plaintext), vault.id)
    const updated: StoredVault = { version, id: vault.id, salt: encode(salt), iv: encode(iv), data: encode(data), check: tag }
    const save = () => {
      if (localStorage.getItem(VAULT_KEY) !== raw) throw new Error('The saved wallet changed. Try again.')
      localStorage.setItem(VAULT_KEY, JSON.stringify(updated))
    }
    if (navigator.locks) await navigator.locks.request(VAULT_KEY, save)
    else save()
  } finally {
    plaintext.fill(0)
  }
}

export async function removeVault(walletId: string) {
  const remove = () => {
    const raw = localStorage.getItem(VAULT_KEY)
    if (!raw || JSON.parse(raw).id !== walletId) throw new Error('The saved wallet changed. Try again.')
    localStorage.removeItem(VAULT_KEY)
  }
  if (navigator.locks) await navigator.locks.request(VAULT_KEY, remove)
  else remove()
}

/** Open the saved vault with a phrase from passkey unlock. */
export async function passkeySession(id: string, phrase: string) {
  const raw = localStorage.getItem(VAULT_KEY)
  if (!raw || JSON.parse(raw).id !== id || !validPhrase(phrase)) throw new Error('Face ID didn’t work. Use your password.')
  const session = await walletSession(id, phrase, activeAccount(id), true)
  await addPhraseCheck(raw, phrase)
  return session
}
