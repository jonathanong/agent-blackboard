import { hashToken } from '../auth/hash.mjs'
import { generateClientToken } from '../auth/tokens.mjs'
import type { CredentialRecord, Session, SessionEntry } from '../core/types.mjs'
import { SessionStoreError } from './errors.mjs'
import { matchesListFilter, resumeIndex, sortSessions } from './memory-session-query.mjs'
import { decodeSessionCursor, encodeSessionCursor } from './session-cursor.mjs'
import {
  DEFAULT_SESSIONS_LIMIT,
  MAX_SESSIONS_LIMIT,
  type CredentialIdOrName,
  type ListSessionsQuery,
  type ListSessionsResult,
  type NewSession,
  type NewSessionEntry,
  type BlackboardStore,
  type SessionPatch,
} from './store.mjs'

export interface MemoryStoreOptions {
  now?: () => Date
}

/** In-memory `BlackboardStore` for unit tests and local dev. */
export class MemoryBlackboardStore implements BlackboardStore {
  readonly #sessions = new Map<string, Session>()
  readonly #entries = new Map<string, SessionEntry>()
  readonly #credentials = new Map<string, CredentialRecord>()
  readonly #now: () => Date

  constructor(options: MemoryStoreOptions = {}) {
    this.#now = options.now ?? ((): Date => new Date())
  }

  async createSession(input: NewSession): Promise<Session> {
    const key = this.#sessionKey(input.credId, input.id)
    if (this.#sessions.has(key)) {
      throw new SessionStoreError('session_exists', `session already exists: ${input.id}`)
    }
    if (input.parentSessionId !== null) {
      const parent = this.#sessions.get(this.#sessionKey(input.credId, input.parentSessionId))
      if (!parent) {
        throw new SessionStoreError(
          'parent_not_found',
          `parent session not found: ${input.parentSessionId}`,
        )
      }
    }
    const session: Session = {
      id: input.id,
      parentSessionId: input.parentSessionId,
      agent: input.agent,
      version: input.version,
      createdAt: this.#now().toISOString(),
      lastEntryAt: null,
      archivedAt: null,
      data: {},
    }
    this.#sessions.set(key, session)
    return session
  }

  async getSession(credId: string, sessionId: string): Promise<Session | undefined> {
    return this.#sessions.get(this.#sessionKey(credId, sessionId))
  }

  async listSessions(credId: string, query: ListSessionsQuery = {}): Promise<ListSessionsResult> {
    const prefix = `${credId} `
    const all: Session[] = []
    for (const [key, session] of this.#sessions) {
      if (key.startsWith(prefix)) all.push(session)
    }
    sortSessions(all)

    let start = 0
    if (query.cursor !== undefined) {
      const key = decodeSessionCursor(query.cursor)
      const found = resumeIndex(all, key)
      start = found === -1 ? all.length : found
    }

    const limit = Math.min(Math.max(query.limit ?? DEFAULT_SESSIONS_LIMIT, 1), MAX_SESSIONS_LIMIT)
    const page = all.slice(start, start + limit)
    const now = this.#now()
    const sessions = page.filter((session) => matchesListFilter(session, query, now))

    const last = page.at(-1)
    const nextCursor =
      last && start + limit < all.length
        ? encodeSessionCursor({ createdAt: last.createdAt, sessionId: last.id })
        : null

    return { sessions, nextCursor }
  }

  async patchSession(credId: string, patch: SessionPatch): Promise<Session> {
    const key = this.#sessionKey(credId, patch.sessionId)
    const session = this.#requireWritableSession(credId, patch.sessionId)
    const updated = { ...session, data: { ...session.data, ...patch.data } }
    this.#sessions.set(key, updated)
    return updated
  }

  async archiveSession(credId: string, sessionId: string): Promise<Session> {
    const key = this.#sessionKey(credId, sessionId)
    const session = this.#sessions.get(key)
    if (!session) {
      throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
    }
    if (session.archivedAt !== null) return session
    const archived = { ...session, archivedAt: this.#now().toISOString() }
    this.#sessions.set(key, archived)
    return archived
  }

  async appendEntry(input: NewSessionEntry): Promise<SessionEntry> {
    const sessionKey = this.#sessionKey(input.credId, input.sessionId)
    const session = this.#sessions.get(sessionKey)
    if (!session) {
      throw new SessionStoreError('session_not_found', `session not found: ${input.sessionId}`)
    }
    const timestamp = Math.max(
      this.#now().getTime(),
      session.lastEntryAt === null ? 0 : Date.parse(session.lastEntryAt) + 1,
    )
    const entry: SessionEntry = {
      sessionId: input.sessionId,
      createdAt: new Date(timestamp).toISOString(),
      data: input.data,
    }
    this.#entries.set(this.#entryKey(input.credId, input.sessionId, timestamp), entry)
    this.#sessions.set(sessionKey, { ...session, lastEntryAt: entry.createdAt })
    return entry
  }

  async *getEntries(
    credId: string,
    sessionId: string,
    options: { sessionVerified?: boolean } = {},
  ): AsyncIterable<SessionEntry> {
    if (!options.sessionVerified && !this.#sessions.has(this.#sessionKey(credId, sessionId))) {
      throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
    }
    const prefix = `${credId} ${sessionId} `
    for (const [key, entry] of this.#entries) {
      if (key.startsWith(prefix)) yield entry
    }
  }

  async createCredential(name: string): Promise<{ record: CredentialRecord; token: string }> {
    const { credId, token } = generateClientToken()
    const record = {
      id: credId,
      name,
      tokenHash: hashToken(token),
      createdAt: this.#now().toISOString(),
    }
    this.#credentials.set(credId, record)
    return { record, token }
  }

  async listCredentials(): Promise<CredentialRecord[]> {
    return [...this.#credentials.values()]
  }

  async getCredentialById(id: string): Promise<CredentialRecord | undefined> {
    return this.#credentials.get(id)
  }

  async deleteCredential(idOrName: CredentialIdOrName): Promise<boolean> {
    if (idOrName.id) return this.#credentials.delete(idOrName.id)
    if (!idOrName.name) return false
    const matchingIds = [...this.#credentials.entries()]
      .filter(([, record]) => record.name === idOrName.name)
      .map(([id]) => id)
    for (const id of matchingIds) this.#credentials.delete(id)
    return matchingIds.length > 0
  }

  #requireWritableSession(credId: string, sessionId: string): Session {
    const session = this.#sessions.get(this.#sessionKey(credId, sessionId))
    if (!session) {
      throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
    }
    if (session.archivedAt !== null) {
      throw new SessionStoreError(
        'session_archived',
        `session is archived; create a new session to change metadata: ${sessionId}`,
      )
    }
    return session
  }

  #sessionKey(credId: string, sessionId: string): string {
    return `${credId} ${sessionId}`
  }

  #entryKey(credId: string, sessionId: string, timestamp: number): string {
    return `${credId} ${sessionId} ${new Date(timestamp).toISOString()}`
  }
}
