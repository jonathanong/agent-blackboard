import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string equality. Never throws on a length mismatch — instead
 * still performs a `timingSafeEqual` call of comparable cost (against itself)
 * so the length check doesn't leak timing information relative to the
 * equal-length path.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
