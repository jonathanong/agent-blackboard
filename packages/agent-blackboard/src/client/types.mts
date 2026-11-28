import type { SchemaShadowWarning } from './schema-types.mjs'

export interface ClientConfig {
  baseUrl: string
  token: string
  /** Opt in to bounded retries for safe GET requests. */
  readRetry?: ReadRetryOptions
  /** Optional observer invoked whenever a response carries `x-schema-registry-revision`. */
  onSchemaRevision?: (revision: number) => void
}

/** Bounded retry settings for GET requests that fail before a response or transiently. */
export interface ReadRetryOptions {
  /** Retries after the initial request. Defaults to 2. */
  maxRetries?: number
  /** First retry delay in milliseconds. Defaults to 100. */
  initialDelayMs?: number
  /** Maximum retry delay in milliseconds. Defaults to 1000. */
  maxDelayMs?: number
}

export interface Session {
  id: string
  parentSessionId: string | null
  agent: string
  version: string
  createdAt: string
  lastEntryAt: string | null
  archivedAt: string | null
  data: Record<string, unknown>
}

export interface SessionEntry {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
  expiresAt?: string
}

export interface AppendEntryResult extends SessionEntry {
  warning?: SchemaShadowWarning
  redactedCount?: number
}

export interface PatchSessionResult extends Session {
  redactedCount?: number
}

export interface CreateSessionInput {
  id: string
  parentSessionId: string | null
  agent: string
  version: string
}

export interface PatchSessionInput {
  sessionId: string
  data: Record<string, unknown>
}

/**
 * Duplicated independently from `packages/server`'s `ListSessionsQuery`
 * rather than imported/re-exported: dependency-cruiser forbids
 * `agent-blackboard` from depending on `packages/server` or `@aws-sdk` at
 * all, so the wire contract for `GET /sessions` is intentionally maintained
 * in both places. Keep this shape in sync with
 * `packages/server/src/store/store.mts`'s `ListSessionsQuery` by hand.
 */
export interface ListSessionsQuery {
  archived?: boolean
  agent?: string
  version?: string
  parentSessionId?: string | null
  data?: Record<string, unknown>
  dataArrayContains?: Record<string, string>
  inactiveForHours?: number
  limit?: number
  cursor?: string
}

export interface ListSessionsResult {
  sessions: Session[]
  nextCursor: string | null
}

export interface AppendEntryInput {
  sessionId: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
}

export type EntryWireFormat = 'json' | 'jsonl' | 'markdown'
export type StructuredEntryFormat = Extract<EntryWireFormat, 'json' | 'jsonl'>

export interface GetEntriesQuery {
  sessionId: string
  format?: StructuredEntryFormat
}

export interface GetRawEntriesQuery {
  sessionId: string
  format?: EntryWireFormat
}

export interface CredentialSummary {
  id: string
  name: string
  createdAt: string
}

export interface CredentialCreated extends CredentialSummary {
  token: string
}
