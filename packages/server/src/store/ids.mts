import { randomBytes } from 'node:crypto'

const BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeBase32(value: bigint, length: number): string {
  let out = ''
  let remaining = value
  for (let i = 0; i < length; i++) {
    out = BASE32_ALPHABET[Number(remaining & 31n)] + out
    remaining >>= 5n
  }
  return out
}

/**
 * A tiny local ULID-style id generator: 10 Crockford-base32 chars encoding
 * the epoch-ms timestamp (time-sortable, 50 bits — comfortably covers a
 * 48-bit ms timestamp) followed by 16 chars encoding 80 bits of randomness.
 * Deliberately not the `ulid` npm package — avoids adding a new dependency
 * for what's a well-known, simple encoding.
 */
export function generateEntryId(now: Date): string {
  const time = BigInt(now.getTime())
  const random = BigInt(`0x${randomBytes(10).toString('hex')}`)
  return `${encodeBase32(time, 10)}${encodeBase32(random, 16)}`
}
