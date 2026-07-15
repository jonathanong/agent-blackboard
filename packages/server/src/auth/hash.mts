import { createHash } from 'node:crypto'

/** sha256 hex digest of a token — the only form of a journaling token ever persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
