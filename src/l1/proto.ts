import { concat, utf8 } from './common'

/** Minimal protobuf writer: varints and length-delimited fields, zero values left out. */
export function varint(value: bigint | number) {
  let rest = BigInt(value)
  const out: number[] = []
  while (rest > 0x7fn) { out.push(Number(rest & 0x7fn) | 0x80); rest >>= 7n }
  out.push(Number(rest))
  return Uint8Array.from(out)
}

export function uintField(field: number, value: bigint | number) {
  return BigInt(value) === 0n ? new Uint8Array() : concat(varint(field << 3), varint(value))
}

export function bytesField(field: number, value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? utf8(value) : value
  return bytes.length ? concat(varint((field << 3) | 2), varint(bytes.length), bytes) : new Uint8Array()
}

/** Embedded message, kept even when empty. */
export function messageField(field: number, value: Uint8Array) {
  return concat(varint((field << 3) | 2), varint(value.length), value)
}
