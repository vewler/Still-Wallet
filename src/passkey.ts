import { VAULT_KEY } from './storage'
import type { Session } from './vault'

// Face ID / fingerprint unlock. The passkey's PRF output (a secret only the
// authenticator can produce, after Face ID) derives the key that encrypts a
// second copy of the phrase. The password vault stays as it is.
const PASSKEY_KEY = 'still.passkey.v1'
const encoder = new TextEncoder()

type StoredPasskey = { version: 1; vault: string; credential: string; salt: string; iv: string; data: string }

const toBase64 = (data: Uint8Array) => btoa(String.fromCharCode(...data))
const fromBase64 = (data: string) => Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
const associatedData = (vault: string) => encoder.encode(`still/passkey/1/${vault}`)

type PrfResults = { enabled?: boolean; results?: { first?: BufferSource } }
type PrfExtensions = AuthenticationExtensionsClientInputs & { prf?: { eval: { first: BufferSource } } }

/** Phones and tablets only. */
export function passkeyDevice() {
  return typeof PublicKeyCredential !== 'undefined' && globalThis.isSecureContext && matchMedia('(hover: none) and (pointer: coarse)').matches
}

function stored(): StoredPasskey | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(PASSKEY_KEY) ?? 'null') as StoredPasskey | null
    const vault = JSON.parse(localStorage.getItem(VAULT_KEY) ?? 'null') as { id?: string } | null
    if (value?.version === 1 && vault?.id && value.vault === vault.id) return value
  } catch { /* Corrupted entry counts as off. */ }
  return undefined
}

export const passkeyOn = () => passkeyDevice() && !!stored()

async function wrapKey(secret: BufferSource, vault: string) {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(vault), info: encoder.encode('still/passkey/1') },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

function prfOf(credential: Credential | null) {
  return ((credential as PublicKeyCredential | null)?.getClientExtensionResults() as { prf?: PrfResults } | undefined)?.prf
}

function friendly(problem: unknown, fallback: string) {
  if (problem instanceof DOMException && (problem.name === 'NotAllowedError' || problem.name === 'AbortError')) return new Error('Cancelled')
  return problem instanceof Error && problem.message ? problem : new Error(fallback)
}

async function assertion(credential: string, salt: Uint8Array<ArrayBuffer>) {
  const extensions: PrfExtensions = { prf: { eval: { first: salt } } }
  const result = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: location.hostname,
    allowCredentials: [{ type: 'public-key', id: fromBase64(credential) }],
    userVerification: 'required',
    timeout: 60_000,
    extensions,
  } })
  const first = prfOf(result)?.results?.first
  if (!first) throw new Error('This device can’t use passkey unlock.')
  return first
}

export type PasskeySetup = { done: true } | { done: false; confirm: () => Promise<void> }

/** Step 1 runs inside the tap. If the phone needs a 2nd Face ID check, `confirm` runs it on the next tap. */
export async function enablePasskey(session: Session, walletName: string): Promise<PasskeySetup> {
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const extensions: PrfExtensions = { prf: { eval: { first: salt } } }
  let created: Credential | null
  try {
    created = await navigator.credentials.create({ publicKey: {
      rp: { id: location.hostname, name: 'Still Wallet' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: walletName || 'Still Wallet', displayName: walletName || 'Still Wallet' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      timeout: 60_000,
      extensions,
    } })
  } catch (problem) { throw friendly(problem, 'The passkey could not be created.') }
  if (!created) throw new Error('The passkey could not be created.')
  const prf = prfOf(created)
  if (prf?.enabled === false) throw new Error('This device can’t use passkey unlock.')
  const credential = toBase64(new Uint8Array((created as PublicKeyCredential).rawId))
  const save = async (secret: BufferSource) => {
    const key = await wrapKey(secret, session.vault)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = encoder.encode(session.mnemonic)
    try {
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(session.vault) }, key, plaintext)
      const value: StoredPasskey = { version: 1, vault: session.vault, credential, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }
      localStorage.setItem(PASSKEY_KEY, JSON.stringify(value))
    } finally { plaintext.fill(0) }
  }
  const first = prf?.results?.first
  if (first) { await save(first); return { done: true } }
  return { done: false, confirm: async () => {
    try { await save(await assertion(credential, salt)) } catch (problem) { throw friendly(problem, 'Passkey unlock could not be turned on.') }
  } }
}

export function disablePasskey() {
  const value = stored()
  localStorage.removeItem(PASSKEY_KEY)
  // Tell the phone the passkey is gone so it drops out of the passwords list, where supported.
  const signal = (PublicKeyCredential as unknown as { signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void> }).signalUnknownCredential
  if (value && signal) {
    const credentialId = value.credential.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    void signal.call(PublicKeyCredential, { rpId: location.hostname, credentialId }).catch(() => {})
  }
}

export async function unlockWithPasskey(): Promise<Session> {
  const value = stored()
  if (!value) throw new Error('Passkey unlock is off.')
  let secret: BufferSource
  try { secret = await assertion(value.credential, fromBase64(value.salt)) } catch (problem) { throw friendly(problem, 'Face ID didn’t work. Use your password.') }
  let phrase = ''
  try {
    const key = await wrapKey(secret, value.vault)
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(value.iv), additionalData: associatedData(value.vault) }, key, fromBase64(value.data)))
    try { phrase = new TextDecoder().decode(plaintext) } finally { plaintext.fill(0) }
  } catch {
    throw new Error('Face ID didn’t work. Use your password.')
  }
  const { passkeySession } = await import('./vault')
  return passkeySession(value.vault, phrase)
}
