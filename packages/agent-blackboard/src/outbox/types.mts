export interface OutboxTarget {
  /** Normalized server origin, or `'loopback'` for local loopback servers. */
  server: string
  /** Non-secret credential id extracted from `abb_sk_<credId>_<secret>` when present. */
  credentialId?: string
}

export interface OutboxPendingRecord {
  id: string
  queuedAt: string
  sessionId: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
  sourceEventId: string
  lastError: string
  /** Non-secret server + credential namespace that queued this entry. */
  target?: OutboxTarget
}

export interface OutboxRejectedRecord extends OutboxPendingRecord {
  rejectedAt: string
  status?: number
  error: string
  errorBody?: unknown
}

export interface OutboxSessionCounts {
  pending: number
  rejected: number
}

export interface OutboxStatus {
  dir: string
  pending: number
  rejected: number
  sessions: Record<string, OutboxSessionCounts>
  rejectedRecords: OutboxRejectedRecord[]
  /** Paths of unreadable or malformed `.json` files skipped in `pending/` or `rejected/`. */
  corruptFiles?: string[]
}

export interface OutboxFlushOptions {
  /** Only flush pending entries for this session id. */
  sessionId?: string
  dir?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface OutboxFlushResult {
  dir: string
  delivered: number
  duplicates: number
  rejected: number
  /** Count of pending records skipped because they belong to a different server or credential namespace. */
  skipped?: number
  remaining: number
}

export interface OutboxPruneOptions {
  /** Remove only the rejected record with this outbox id. */
  id?: string
  /** Remove rejected records belonging to this session id. */
  sessionId?: string
  dir?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface OutboxPruneResult {
  dir: string
  removed: number
  remainingRejected: number
}

export interface OutboxLocationOptions {
  dir?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}
