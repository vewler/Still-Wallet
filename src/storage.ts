import { importNetworks, networks, type Environment, type NetworkId, validateEndpoint } from './networks'
import { cleanLabel, type UserToken } from './tokens'
import { forgetApps } from './walletconnect'

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
  /** Custom swap slippage in basis points (100 = 1%), set in Settings. Unset = no Custom option. */
  slippage?: number
}

/** Custom slippage limits in basis points: 0.01% to 50%. */
export const customSlippageRange = [1, 5000] as const
export const validCustomSlippage = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= customSlippageRange[0] && (value as number) <= customSlippageRange[1]

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
  /** Sender, for chains that look transactions up by sender (NEAR). */
  from?: string
  asset?: string
  destinationTag?: number
  kind?: 'swap' | 'approval' | 'dapp'
  receive?: { amount: string; minimum: string; symbol: string }
  /** Connected app that asked for it. */
  app?: string
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
    try { rpc[key] = validateEndpoint(endpoint, networks[key].chain) } catch { /* Ignore corrupted preferences. */ }
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
    ...(validCustomSlippage(value.slippage) ? { slippage: value.slippage } : {}),
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
// In chunks: Safari caps call arguments at 65536 and a long history is bigger.
function toBase64(data: Uint8Array) {
  let text = ''
  for (let start = 0; start < data.length; start += 0x8000) text += String.fromCharCode(...data.subarray(start, start + 0x8000))
  return btoa(text)
}
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

type Accounts = { vault: string; count: number; active: number; order: number[] }

function readAccounts(vault: string): Accounts {
  const value = read<Partial<Accounts> | null>(ACCOUNTS_KEY, null)
  if (!value || value.vault !== vault) return { vault, count: 1, active: 0, order: [0] }
  const count = Math.min(100, Math.max(1, Math.floor(Number(value.count)) || 1))
  // Wallet order on the Wallets sheet. Deleted wallets are left out. 100-199 are wallets with their own phrase.
  const saved = Array.isArray(value.order) ? value.order.filter((account): account is number => Number.isInteger(account) && account >= 0 && (account < count || (account >= 100 && account < 200))) : []
  const order = saved.length ? [...new Set(saved)] : Array.from({ length: count }, (_, account) => account)
  const active = Math.floor(Number(value.active)) || 0
  return { vault, count, active: order.includes(active) ? active : order[0], order }
}

const accountId = (vault: string, account: number) => account ? `${vault}:${account}` : vault

export function walletIds(vault: string) {
  return readAccounts(vault).order.map((account) => ({ account, id: accountId(vault, account) }))
}

export function activeAccount(vault: string) {
  return readAccounts(vault).active
}

export function saveAccounts(vault: string, change: Partial<Omit<Accounts, 'vault'>>) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ ...readAccounts(vault), ...change, vault }))
}

/** Next free account slot (a deleted one first), or undefined at 100. */
export function nextAccount(vault: string) {
  const { order } = readAccounts(vault)
  for (let account = 0; account < 100; account++) if (!order.includes(account)) return account
}

/** Next free slot for a wallet with its own phrase, or undefined at 100 of them. */
export function nextOwnPhraseSlot(vault: string) {
  const { order } = readAccounts(vault)
  for (let slot = 100; slot < 200; slot++) if (!order.includes(slot)) return slot
}

/** Drops a wallet's name, emoji, activity, Home layout and tokens from this device. */
export function forgetWallet(id: string) {
  clearActivity(id)
  for (const key of [NAMES_KEY, EMOJI_KEY]) {
    const map = read<Record<string, unknown>>(key, {})
    if (map && id in map) { delete map[id]; localStorage.setItem(key, JSON.stringify(map)) }
  }
  for (const key of Object.keys(localStorage)) {
    if (key === TOKENS_PREFIX + id || (key.startsWith(ASSETS_PREFIX) && (key === ASSETS_PREFIX + id || key.endsWith(`.${id}`)))) localStorage.removeItem(key)
  }
  for (const name of [...sealed.keys()]) if (name === TOKENS_PREFIX + id || (name.startsWith(ASSETS_PREFIX) && name.endsWith(`.${id}`))) sealed.delete(name)
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
  sealed.clear()
  for (const key of Object.keys(localStorage)) if (key.startsWith('still.')) localStorage.removeItem(key)
  // Encrypted XMR scan caches.
  try { indexedDB.deleteDatabase('still-monero') } catch { /* Nothing saved. */ }
  // Connected apps belong to the deleted wallet too.
  void forgetApps().catch(() => {})
}

/* Per-wallet Home coins and their order. */
/*
 * Per-wallet Home coins, their order, and imported or found tokens. They show what a wallet holds,
 * so they're encrypted with the wallet's activity key like history. Read after unlock, kept in memory until lock.
 */
const ASSETS_PREFIX = 'still.assets.v1.'
const TOKENS_PREFIX = 'still.tokens.v1.'
const layouts = ['phone', 'desktop'] as const
const sealed = new Map<string, { key: CryptoKey; value: unknown }>()
const sealedData = (name: string) => new TextEncoder().encode(`still/sealed/1/${name}`)
let sealedWrites: Promise<void> = Promise.resolve()

async function openSealed(name: string, key: CryptoKey, legacy: string[] = []) {
  const cached = sealed.get(name)
  if (cached && cached.key === key) return cached.value
  const stored = read<unknown>(name, null)
  let value: unknown = null
  let migrate = false
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && typeof (stored as { iv?: unknown }).iv === 'string') {
    try {
      const { iv, data } = stored as { iv: string; data: string }
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: sealedData(name) }, key, fromBase64(data))
      value = JSON.parse(new TextDecoder().decode(plain))
    } catch { /* Unreadable data starts empty. */ }
  } else {
    // Saved before encryption: move it into the encrypted form.
    value = stored ?? legacy.map((other) => read<unknown>(other, null)).find((entry) => entry !== null) ?? null
    migrate = value !== null
  }
  sealed.set(name, { key, value })
  if (migrate) { writeSealed(name, value); legacy.forEach((other) => localStorage.removeItem(other)) }
  return value
}

function writeSealed(name: string, value: unknown) {
  const entry = sealed.get(name)
  if (!entry) throw new Error('Unlock the wallet to save this.')
  entry.value = value
  const write = async () => {
    if (sealed.get(name) !== entry || entry.value !== value) return
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: sealedData(name) }, entry.key, new TextEncoder().encode(JSON.stringify(value)))
    if (sealed.get(name) === entry && entry.value === value) localStorage.setItem(name, JSON.stringify({ iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }))
  }
  sealedWrites = sealedWrites.then(write, write).catch(() => {})
}

/** Decrypts a wallet's token list and both Home layouts. Call before reading them. */
export async function openWalletData(walletId: string, key: CryptoKey) {
  await Promise.all([
    openSealed(TOKENS_PREFIX + walletId, key),
    // Phone and desktop keep separate lists, the old shared one is their starting point.
    ...layouts.map((layout) => openSealed(`${ASSETS_PREFIX}${layout}.${walletId}`, key, layout === 'desktop' ? [ASSETS_PREFIX + walletId] : [])),
  ])
}

/** Resolves when queued token list and layout writes are saved. */
export function walletDataSaved() {
  return sealedWrites
}

/** Drop decrypted token lists and layouts on lock. */
export function forgetWalletData() {
  sealed.clear()
}

const layoutKey = (walletId: string) => `${ASSETS_PREFIX}${document.documentElement.dataset.layout === 'phone' ? 'phone' : 'desktop'}.${walletId}`

export function readAssetLayout(walletId: string, fallback: { order: string[]; shown: string[] }) {
  const value = (sealed.get(layoutKey(walletId))?.value ?? sealed.get(`${ASSETS_PREFIX}desktop.${walletId}`)?.value) as { order?: unknown; shown?: unknown } | null | undefined
  if (!value || typeof value !== 'object') return fallback
  const list = (entry: unknown) => Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string').slice(0, 200) : []
  return { order: list(value.order), shown: list(value.shown) }
}

export function saveAssetLayout(walletId: string, value: { order: string[]; shown: string[] }) {
  writeSealed(layoutKey(walletId), value)
}

export function readUserTokens(walletId: string): UserToken[] {
  const value = sealed.get(TOKENS_PREFIX + walletId)?.value
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): UserToken[] => {
    if (!entry || typeof entry !== 'object') return []
    const { network, contract, symbol, name, decimals, user, verified } = entry as Record<string, unknown>
    if (typeof network !== 'string' || !importNetworks.includes(network as NetworkId) || typeof contract !== 'string' || !/^(?:0x[\da-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(contract)) return []
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return []
    const cleanSymbol = cleanLabel(symbol, 12)
    if (!cleanSymbol) return []
    return [{ network: network as NetworkId, contract, symbol: cleanSymbol, name: cleanLabel(name, 40) || cleanSymbol, decimals, user: user === 'found' ? 'found' : 'custom', verified: verified === true }]
  }).slice(0, 200)
}

export function saveUserTokens(walletId: string, list: UserToken[]) {
  writeSealed(TOKENS_PREFIX + walletId, list)
}

/* Address book. Shared by every wallet in the vault, encrypted with the vault key like activity. */
const CONTACTS_PREFIX = 'still.contacts.v1.'
export type Contact = { id: string; name: string; emoji?: string; address: string; network: NetworkId }
const contacts = new Map<string, { key: CryptoKey; items: Contact[] }>()
const contactsData = (vault: string) => new TextEncoder().encode(`still/contacts/1/${vault}`)

export function normalizeContactName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 32)
}

function validContacts(value: unknown): Contact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): Contact[] => {
    if (!entry || typeof entry !== 'object') return []
    const { id, name, emoji, address, network } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string' || typeof address !== 'string' || typeof network !== 'string' || !Object.hasOwn(networks, network)) return []
    const clean = normalizeContactName(name)
    if (!clean || !address.trim()) return []
    return [{ id, name: clean, address: address.trim().slice(0, 100), network: network as NetworkId, ...(typeof emoji === 'string' && isWalletEmoji(emoji) ? { emoji } : {}) }]
  }).slice(0, 500)
}

export async function loadContacts(vault: string, key: CryptoKey) {
  const stored = read<{ iv?: string; data?: string } | null>(CONTACTS_PREFIX + vault, null)
  let items: Contact[] = []
  if (stored?.iv && stored.data) {
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(stored.iv), additionalData: contactsData(vault) }, key, fromBase64(stored.data))
      items = validContacts(JSON.parse(new TextDecoder().decode(plain)))
    } catch { /* Unreadable book starts empty. */ }
  }
  contacts.set(vault, { key, items })
  return items
}

export async function saveContacts(vault: string, items: Contact[]) {
  const entry = contacts.get(vault)
  if (!entry) throw new Error('Unlock the wallet to edit contacts.')
  entry.items = items
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: contactsData(vault) }, entry.key, new TextEncoder().encode(JSON.stringify(items)))
  localStorage.setItem(CONTACTS_PREFIX + vault, JSON.stringify({ iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }))
  return items
}

/** Clear decrypted contacts on lock. */
export function forgetContacts() {
  contacts.clear()
}

/** Older vaults have no phrase check: a key that opens any saved contacts or history proves the phrase. Undefined when nothing encrypted is saved. */
export async function opensSavedData(vault: string, key: CryptoKey) {
  const saved: { iv: string; data: string; ad: Uint8Array<ArrayBuffer> }[] = []
  const contactsBlob = read<{ iv?: string; data?: string } | null>(CONTACTS_PREFIX + vault, null)
  if (contactsBlob?.iv && contactsBlob.data) saved.push({ iv: contactsBlob.iv, data: contactsBlob.data, ad: contactsData(vault) })
  for (const name of Object.keys(localStorage)) {
    if (!name.startsWith(ACTIVITY_PREFIX)) continue
    const walletId = name.slice(ACTIVITY_PREFIX.length)
    if (walletId !== vault && !walletId.startsWith(vault + ':')) continue
    const blob = read<{ iv?: string; data?: string } | null>(name, null)
    if (blob && !Array.isArray(blob) && blob.iv && blob.data) saved.push({ iv: blob.iv, data: blob.data, ad: activityData(walletId) })
  }
  if (!saved.length) return undefined
  for (const item of saved) {
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(item.iv), additionalData: item.ad }, key, fromBase64(item.data))
      return true
    } catch { /* Try the next one. */ }
  }
  return false
}
