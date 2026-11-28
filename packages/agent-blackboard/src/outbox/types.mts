export interface OutboxPendingRecord {
  id: string
  queuedAt: string
  sessionId: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
  sourceEventId: string
  lastError: string
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
