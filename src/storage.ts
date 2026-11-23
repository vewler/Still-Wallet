import { networks, type Environment, type NetworkId, validateEndpoint } from './networks'

export const VAULT_KEY = 'still.vault.v1'
const SETTINGS_KEY = 'still.preferences.v1'
const ACTIVITY_PREFIX = 'still.activity.v1.'

export const currencies = ['usd', 'eur', 'gbp', 'chf'] as const
export type Currency = typeof currencies[number]

export type Preferences = {
  currency: Currency
  protect: boolean
  hide: boolean
  offline: boolean
  autoLock: number
  environment: Environment
  rpc: Partial<Record<NetworkId, string>>
}

const defaults: Preferences = { currency: 'usd', protect: false, hide: false, offline: false, autoLock: 5, environment: 'main', rpc: {} }

export type ActivityItem = {
  hash: string
  network: NetworkId
  to: string
  value: string
  created: number
  status: 'submitted' | 'confirmed' | 'failed' | 'unknown' | 'expired'
  lastValidBlockHeight?: number
  lastLedgerSequence?: number
  asset?: string
  destinationTag?: number
  kind?: 'swap' | 'approval'
  receive?: { amount: string; minimum: string; symbol: string }
}

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

export function readPreferences(): Preferences {
  const value = read<Partial<Preferences> | null>(SETTINGS_KEY, null)
  if (!value || typeof value !== 'object') return defaults
  const rpc: Preferences['rpc'] = {}
  for (const key of Object.keys(networks) as NetworkId[]) {
    const endpoint = value.rpc?.[key]
    if (typeof endpoint !== 'string') continue
    try { rpc[key] = validateEndpoint(endpoint) } catch { /* Ignore corrupted preferences. */ }
  }
  return {
    currency: currencies.includes(value.currency as Currency) ? value.currency! : defaults.currency,
    protect: value.protect === true,
    hide: value.hide === true,
    offline: value.offline === true,
    environment: 'main',
    // The 1h option was removed, fall back to the longest one left.
    autoLock: value.autoLock === 60 ? 30 : [0, 1, 5, 15, 30].includes(value.autoLock ?? -1) ? value.autoLock! : defaults.autoLock,
    rpc,
  }
}

export function savePreferences(value: Preferences) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
}

// Activity is encrypted with a key from the recovery phrase, unreadable while locked.
// Decrypted copy lives in memory, writes are queued in order.
const activity = new Map<string, { key: CryptoKey; items: ActivityItem[] }>()
let writes: Promise<void> = Promise.resolve()
let lastWrite: Promise<void> = Promise.resolve()
const toBase64 = (data: Uint8Array) => btoa(String.fromCharCode(...data))
const fromBase64 = (data: string) => Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
const activityData = (walletId: string) => new TextEncoder().encode(`still/activity/1/${walletId}`)

function validActivity(value: unknown): ActivityItem[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.hash === 'string' && Object.hasOwn(networks, entry.network)) : []
}

export async function loadActivity(walletId: string, key: CryptoKey) {
  const stored = read<unknown>(ACTIVITY_PREFIX + walletId, [])
  let items: ActivityItem[] = []
  if (Array.isArray(stored)) items = validActivity(stored)
  else if (stored && typeof stored === 'object') {
    try {
      const { iv, data } = stored as { iv: string; data: string }
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: activityData(walletId) }, key, fromBase64(data))
      items = validActivity(JSON.parse(new TextDecoder().decode(plain)))
    } catch { /* Unreadable history starts empty. */ }
  }
  activity.set(walletId, { key, items })
  // Migrate history saved before encryption.
  if (Array.isArray(stored) && stored.length) persistActivity(walletId)
  return items
}

function persistActivity(walletId: string) {
  const write = async () => {
    const entry = activity.get(walletId)
    if (!entry) return
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: activityData(walletId) }, entry.key, new TextEncoder().encode(JSON.stringify(entry.items)))
    if (activity.get(walletId) === entry) localStorage.setItem(ACTIVITY_PREFIX + walletId, JSON.stringify({ iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }))
  }
  lastWrite = writes.then(write, write)
  writes = lastWrite.catch(() => {})
}

/** Resolves when every queued write is saved (rejects if the last one failed). */
export function activitySaved() {
  return lastWrite
}

export function readActivity(walletId: string): ActivityItem[] {
  return activity.get(walletId)?.items ?? []
}

export function saveActivity(walletId: string, item: ActivityItem) {
  const entry = activity.get(walletId)
  if (!entry) throw new Error('Unlock the wallet to save activity.')
  const items = entry.items.filter((existing) => existing.hash !== item.hash || existing.network !== item.network)
  // Cap at 200 entries.
  entry.items = [item, ...items].sort((a, b) => b.created - a.created).slice(0, 200)
  persistActivity(walletId)
  return entry.items
}

/** Clear decrypted history on lock. */
export function forgetActivity() {
  activity.clear()
}

export function clearActivity(walletId: string) {
  activity.delete(walletId)
  localStorage.removeItem(ACTIVITY_PREFIX + walletId)
}

const NAMES_KEY = 'still.walletNames.v1'
const COUNT_KEY = 'still.walletCount.v1'

export function savedVaultId(): string | undefined {
  const vault = read<{ id?: unknown } | null>(VAULT_KEY, null)
  return vault && typeof vault.id === 'string' ? vault.id : undefined
}

export function normalizeWalletName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 24)
}

/** Returns the wallet's saved name, assigning the next "Wallet N" the first time a wallet is seen. */
export function walletName(id: string): string {
  const names = read<Record<string, unknown>>(NAMES_KEY, {})
  const saved = names && typeof names[id] === 'string' ? normalizeWalletName(names[id] as string) : ''
  if (saved) return saved
  const count = Math.max(0, Math.floor(Number(read<unknown>(COUNT_KEY, 0)) || 0)) + 1
  const name = `Wallet ${count}`
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify({ ...names, [id]: name }))
    localStorage.setItem(COUNT_KEY, JSON.stringify(count))
  } catch { /* Fall back to an unsaved default name. */ }
  return name
}

export function saveWalletName(id: string, value: string) {
  const name = normalizeWalletName(value)
  if (!name) throw new Error('Enter a wallet name.')
  const names = read<Record<string, unknown>>(NAMES_KEY, {})
  localStorage.setItem(NAMES_KEY, JSON.stringify({ ...names, [id]: name }))
  return name
}

const ACCOUNTS_KEY = 'still.accounts.v1'
const FAILURES_KEY = 'still.failedUnlocks.v1'
export const maxUnlockAttempts = 5

/** Wrong-password count, survives reloads. */
export function failedUnlocks() {
  return Math.max(0, Math.floor(Number(read<unknown>(FAILURES_KEY, 0))) || 0)
}

export function saveFailedUnlocks(count: number) {
  if (count) localStorage.setItem(FAILURES_KEY, JSON.stringify(count))
  else localStorage.removeItem(FAILURES_KEY)
}
const EMOJI_KEY = 'still.walletEmoji.v1'
/** Avatar emoji, grouped like a phone emoji keyboard. */
export const emojiCategories: { name: string; emojis: string[] }[] = [
  { name: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'] },
  { name: 'People', emojis: ['👁️', '👀', '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '✍️', '💅', '💪', '🦾', '🧠', '🫀', '🦷', '🦴', '👅', '👄', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🥷', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💃', '🕺', '👑', '🎩', '🧢', '👓', '🕶️'] },
  { name: 'Animals', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🐘', '🦛', '🦏', '🐪', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐿️', '🦔', '🐉', '🐲', '🌵', '🎄', '🌲', '🌴', '🌱', '🌿', '🍀', '🍁', '🍄', '🌸', '🌺', '🌻', '🌹', '🌷', '🌼'] },
  { name: 'Food', emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🍘', '🍥', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🥜', '🍯', '🥛', '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🍸', '🍹', '🧉', '🧊'] },
  { name: 'Activity', emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '🏹', '🎣', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '🏂', '🏋️', '🤸', '⛹️', '🤺', '🏄', '🏊', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎗️', '🎫', '🎟️', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🕹️', '🎰', '🧩'] },
  { name: 'Travel', emojis: ['🚗', '🚕', '🚙', '🚌', '🏎️', '🚓', '🚑', '🚒', '🚚', '🚜', '🛵', '🏍️', '🚲', '🛴', '🚨', '🚔', '🚘', '🚖', '🚡', '🚠', '🚃', '🚋', '🚝', '🚄', '🚅', '🚂', '✈️', '🛫', '🛬', '🚀', '🛸', '🚁', '⛵', '🚤', '🛳️', '🚢', '⚓', '🗽', '🗼', '🏰', '🏯', '🎡', '🎢', '🎠', '⛲', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '🏠', '🏡', '🏢', '🏛️', '⛩️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁', '🌍', '🌎', '🌏', '🪐', '🌙', '🌛', '🌜', '🌚', '🌝', '🌞', '⭐', '🌟', '✨', '⚡', '☄️', '🔥', '💥', '🌈', '☀️', '⛅', '☁️', '🌧️', '⛈️', '🌩️', '❄️', '☃️', '⛄', '🌪️', '🌊', '💧'] },
  { name: 'Objects', emojis: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💽', '💾', '💿', '📀', '📷', '📸', '📹', '🎥', '📞', '☎️', '📺', '📻', '🎙️', '⏰', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🔮', '🧿', '📿', '💈', '⚗️', '🔭', '🔬', '💊', '💉', '🧬', '🦠', '🧪', '🌡️', '🧹', '🧺', '🧻', '🚽', '🛁', '🔑', '🗝️', '🚪', '🛋️', '🛏️', '🧸', '🎁', '🎈', '🎏', '🎀', '🎊', '🎉', '🪄', '🏮', '🪅', '✉️', '📦', '📜', '📃', '📑', '📊', '📈', '📉', '🗒️', '📆', '🗓️', '📁', '📌', '📍', '📎', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'] },
  { name: 'Symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '☢️', '☣️', '📴', '📳', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '♿', '🅿️', '🈳', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '🔀', '🔁', '🔂', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '🔄', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄'] },
]
export const defaultWalletEmoji = '👁️'
const allEmojis = new Set(emojiCategories.flatMap((category) => category.emojis))
export function isWalletEmoji(value: string) { return allEmojis.has(value) }

type Accounts = { vault: string; count: number; active: number }

function readAccounts(vault: string): Accounts {
  const value = read<Partial<Accounts> | null>(ACCOUNTS_KEY, null)
  if (!value || value.vault !== vault) return { vault, count: 1, active: 0 }
  const count = Math.min(100, Math.max(1, Math.floor(Number(value.count)) || 1))
  const active = Math.floor(Number(value.active)) || 0
  return { vault, count, active: active >= 0 && active < count ? active : 0 }
}

export function walletIds(vault: string) {
  return Array.from({ length: readAccounts(vault).count }, (_, account) => ({ account, id: account ? `${vault}:${account}` : vault }))
}

export function activeAccount(vault: string) {
  return readAccounts(vault).active
}

export function saveAccounts(vault: string, change: Partial<Omit<Accounts, 'vault'>>) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ ...readAccounts(vault), ...change, vault }))
}

export function walletEmoji(id: string, _account?: number) {
  const saved = read<Record<string, unknown>>(EMOJI_KEY, {})[id]
  return typeof saved === 'string' && isWalletEmoji(saved) ? saved : defaultWalletEmoji
}

export function saveWalletEmoji(id: string, emoji: string) {
  if (!isWalletEmoji(emoji)) throw new Error('Pick one of the listed emoji.')
  localStorage.setItem(EMOJI_KEY, JSON.stringify({ ...read<Record<string, unknown>>(EMOJI_KEY, {}), [id]: emoji }))
}

/** Wipes every Still key in this browser (vault, wallets, names, emoji, activity, settings, counters). */
export function forgetVault() {
  for (const key of Object.keys(localStorage)) if (key.startsWith('still.')) localStorage.removeItem(key)
  // Encrypted XMR scan caches.
  try { indexedDB.deleteDatabase('still-monero') } catch { /* Nothing saved. */ }
}

/* Per-wallet Home coins and their order. */
const ASSETS_PREFIX = 'still.assets.v1.'

/** Phone and desktop keep separate lists. */
const layoutKey = (walletId: string) => `${ASSETS_PREFIX}${document.documentElement.dataset.layout ?? 'desktop'}.${walletId}`

export function readAssetLayout(walletId: string, fallback: { order: string[]; shown: string[] }) {
  // Fall back to the old shared list once.
  const value = read<{ order?: unknown; shown?: unknown } | null>(layoutKey(walletId), null) ?? read<{ order?: unknown; shown?: unknown } | null>(ASSETS_PREFIX + walletId, null)
  if (!value || typeof value !== 'object') return fallback
  const list = (entry: unknown) => Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string').slice(0, 200) : []
  return { order: list(value.order), shown: list(value.shown) }
}

export function saveAssetLayout(walletId: string, value: { order: string[]; shown: string[] }) {
  localStorage.setItem(layoutKey(walletId), JSON.stringify(value))
}
