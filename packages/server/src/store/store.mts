import type { CredentialRecord, Session, SessionEntry } from '../core/types.mjs'

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
  listSessions(credId: string): AsyncIterable<Session>
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
