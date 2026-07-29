import type { CredentialRecord, Session, SessionEntry } from '../core/types.mjs'

export const DEFAULT_SESSIONS_LIMIT = 50
export const MAX_SESSIONS_LIMIT = 200

/**
 * Server-side filter pushdown for `listSessions`. `parentSessionId` and
 * `data` use presence (not `undefined`) to distinguish "no filter" from
 * "filter for this value" — see each field's own comment.
 */
export interface ListSessionsQuery {
  archived?: boolean
  agent?: string
  version?: string
  /** Absent = no filter. `null` = filter for root sessions. String = filter for that parent. */
  parentSessionId?: string | null
  /** Per-key equality filter against the session's `data` object. */
  data?: Record<string, unknown>
  /** Match sessions whose last entry is strictly older than this positive number of hours. */
  inactiveForHours?: number
  limit?: number
  cursor?: string
}

export interface ListSessionsResult {
  sessions: Session[]
  nextCursor: string | null
}

/** Body accepted by `appendEntry`; `credId` comes from authentication. */
export interface NewSessionEntry {
  credId: string
  sessionId: string
  data: Record<string, unknown>
}

export interface NewSession {
  credId: string
  id: string
  parentSessionId: string | null
  agent: string
  version: string
}

export interface SessionPatch {
  sessionId: string
  data: Record<string, unknown>
}

export interface CredentialIdOrName {
  id?: string
  name?: string
}

/**
 * Framework-agnostic blackboard storage interface. All methods are async so a
 * DynamoDB-backed implementation and an in-memory test double can share one
 * contract. `getEntries` streams/paginates internally rather than buffering
 * a full result set — implementations must not load an entire table/session
 * into memory before yielding the first entry.
 */
export interface BlackboardStore {
  createSession(session: NewSession): Promise<Session>
  getSession(credId: string, sessionId: string): Promise<Session | undefined>
  listSessions(credId: string, query?: ListSessionsQuery): Promise<ListSessionsResult>
  patchSession(credId: string, patch: SessionPatch): Promise<Session>
  archiveSession(credId: string, sessionId: string): Promise<Session>

  appendEntry(entry: NewSessionEntry): Promise<SessionEntry>
  getEntries(credId: string, sessionId: string): AsyncIterable<SessionEntry>

  createCredential(name: string): Promise<{ record: CredentialRecord; token: string }>

  listCredentials(): Promise<CredentialRecord[]>

  getCredentialById(id: string): Promise<CredentialRecord | undefined>

  /** Deletes by `id` if given, else deletes ALL credentials matching `name` (names are not unique). Returns whether anything was deleted. */
  deleteCredential(idOrName: CredentialIdOrName): Promise<boolean>
}
