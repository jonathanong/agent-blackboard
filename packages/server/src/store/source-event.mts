import { createHash } from 'node:crypto'
import { SessionStoreError } from './errors.mjs'

export const MAX_SOURCE_EVENT_ID_LENGTH = 256

/** Validates an optional caller-supplied `sourceEventId` for per-session entry idempotency. */
export function isValidSourceEventId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_SOURCE_EVENT_ID_LENGTH &&
    !/[\r\n\0]/.test(value)
  )
}

/** Deterministically serializes JSON values with sorted object keys for content comparison. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export interface EntryContentFingerprint {
  data: Record<string, unknown>
  schemaId?: string | undefined
  schemaVersion?: number | undefined
}

/** Computes a stable SHA-256 digest of an entry's semantic payload and schema tag. */
export function entryContentHash(input: EntryContentFingerprint): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        data: input.data,
        schemaId: input.schemaId ?? null,
        schemaVersion: input.schemaVersion ?? null,
      }),
    )
    .digest('hex')
}

export function sourceEventConflictError(
  sessionId: string,
  createdAt: string,
  sourceEventId: string,
): SessionStoreError {
  return new SessionStoreError(
    'source_event_conflict',
    `sourceEventId "${sourceEventId}" already exists with different content (entry ${sessionId}@${createdAt})`,
    { existingEntry: { sessionId, createdAt, sourceEventId } },
  )
}
