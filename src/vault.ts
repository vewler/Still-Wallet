import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { mnemonicToAccount } from 'viem/accounts'
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit'
import { VAULT_KEY, activeAccount } from './storage'
import type { Addresses } from './networks'
import { bitcoinAddress, bitcoinKey, xrpAddress, xrpKey } from './keys'
import { passwordRules } from './passwords'
import { moneroKeys } from './monero'

const iterations = 600_000
const version = 1
const encoder = new TextEncoder()

type StoredVault = {
  version: 1
  id: string
  salt: string
  iv: string
  data: string
}

export type Session = {
  /** Per-wallet key for names and activity; account 0 keeps the bare vault id. */
  id: string
  vault: string
  account: number
  mnemonic: string
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

async function sessionFor(vault: string, mnemonic: string, account = 0): Promise<Session> {
  if (!Number.isInteger(account) || account < 0 || account >= 100) throw new Error('Invalid wallet.')
  const ethereum = evmAccount(mnemonic, account).address
  const [solanaKey, btc, xrp, xmr, activityKey] = await Promise.all([solanaKeypair(mnemonic, account), bitcoinKey(mnemonic, account), xrpKey(mnemonic, account), moneroWallet(mnemonic, account), deriveActivityKey(mnemonic, vault)])
  const addresses = { ethereum, solana: solanaKey.address, bitcoin: bitcoinAddress(btc.publicKey!), xrp: xrpAddress(xrp.publicKey!), monero: xmr.address }
  btc.wipePrivateData(); xrp.wipePrivateData()
  return { id: account ? `${vault}:${account}` : vault, vault, account, mnemonic, addresses, activityKey }
}

/** Derive another wallet from the unlocked phrase, no password needed. */
export function accountSession(session: Session, account: number) {
  return sessionFor(session.vault, session.mnemonic, account)
}

function associatedData(id: string) {
  return encoder.encode(`still/vault/${version}/${id}`)
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
  const [key, session] = await Promise.all([deriveKey(password, salt), sessionFor(id, mnemonic)])
  const plaintext = encoder.encode(mnemonic)
  let data: ArrayBuffer
  try {
    data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(id) }, key, plaintext)
  } finally {
    plaintext.fill(0)
  }
  const vault: StoredVault = { version, id, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)) }
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
  const session = await sessionFor(id, phrase, activeAccount(id))
  if (localStorage.getItem(VAULT_KEY) !== raw) throw new Error('The saved wallet changed. Try again.')
  return session
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
