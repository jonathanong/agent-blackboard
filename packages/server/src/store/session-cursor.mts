import { SessionStoreError } from './errors.mjs'

/** Positional resume key for `listSessions` pagination: creation-order tiebroken by id. */
export interface SessionCursorKey {
  createdAt: string
  sessionId: string
}

export function encodeSessionCursor(key: SessionCursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url')
}

export function decodeSessionCursor(cursor: string): SessionCursorKey {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new SessionStoreError('invalid_cursor', 'cursor is not valid')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).sessionId !== 'string'
  ) {
    throw new SessionStoreError('invalid_cursor', 'cursor is not valid')
  }
  const { createdAt, sessionId } = parsed as SessionCursorKey
  return { createdAt, sessionId }
}
