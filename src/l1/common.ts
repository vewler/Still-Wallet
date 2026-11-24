export type Fetcher = typeof fetch

/** GET or POST a path under a REST endpoint. 404 resolves to undefined. */
export async function rest<T>(endpoint: string, path: string, fetcher: Fetcher, body?: string, type = 'application/json'): Promise<T | undefined> {
  const response = await fetcher(endpoint.replace(/\/+$/, '') + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': type }, body })
  if (response.status === 404) return undefined
  const data = await response.json().catch(() => undefined) as T | undefined
  if (!response.ok && !(response.status === 400 && data)) throw new Error('The network provider returned an unsuccessful response.')
  if (data === undefined) throw new Error('The network provider returned an unreadable response.')
  return data
}

export function concat(...parts: (Uint8Array | readonly number[])[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

export function utf8(text: string) {
  return new TextEncoder().encode(text)
}

export function base64(bytes: Uint8Array) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
}

export function sameWallet(expected: string, actual: string) {
  if (expected !== actual) throw new Error('This quote belongs to a different wallet.')
}

export function notOwn(from: string, to: string) {
  if (from === to) throw new Error('Enter an address other than your own.')
}
