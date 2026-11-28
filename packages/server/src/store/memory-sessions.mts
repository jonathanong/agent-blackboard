import { redactCredentials } from '../core/redact.mjs'
import type { Session, SessionEntry } from '../core/types.mjs'
import { SessionStoreError } from './errors.mjs'
import { matchesListFilter, resumeIndex, sortSessions } from './memory-session-query.mjs'
import { decodeSessionCursor, encodeSessionCursor } from './session-cursor.mjs'
import {
  computeEntryExpiry,
  DEFAULT_TTL_DAYS,
  resolveEntryTtlDays,
  type RetentionPolicy,
} from './retention.mjs'
import {
  DEFAULT_SESSIONS_LIMIT,
  MAX_SESSIONS_LIMIT,
  type GetEntriesOptions,
  type ListSessionsQuery,
  type ListSessionsResult,
  type NewSession,
  type NewSessionEntry,
  type SessionPatch,
} from './store.mjs'

/** In-memory session and entry store composed by `MemoryBlackboardStore`. */
export class MemorySessionStore {
  readonly #sessions = new Map<string, Session>()
  readonly #entries = new Map<string, SessionEntry>()
  readonly #now: () => Date
  readonly #retention: RetentionPolicy

  constructor(
    now: () => Date,
    retention: RetentionPolicy = { ttlDays: DEFAULT_TTL_DAYS, ttlOverrides: new Map() },
  ) {
    this.#now = now
    this.#retention = retention
  }

  createSession(input: NewSession): Session {
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

  getSession(credId: string, sessionId: string): Session | undefined {
    return this.#sessions.get(this.#sessionKey(credId, sessionId))
  }

  listSessions(credId: string, query: ListSessionsQuery = {}): ListSessionsResult {
    const prefix = `${credId} `
    const all: Session[] = []
    for (const [key, session] of this.#sessions) {
      if (key.startsWith(prefix)) all.push(session)
    }
    sortSessions(all)
    let start = 0
    if (query.cursor !== undefined) {
      const found = resumeIndex(all, decodeSessionCursor(query.cursor))
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

  patchSession(credId: string, patch: SessionPatch): Session {
    const key = this.#sessionKey(credId, patch.sessionId)
    const session = this.#sessions.get(key)
    if (!session) {
      throw new SessionStoreError('session_not_found', `session not found: ${patch.sessionId}`)
    }
    if (session.archivedAt !== null) {
      throw new SessionStoreError(
        'session_archived',
        `session is archived; create a new session to change metadata: ${patch.sessionId}`,
      )
    }
    const { value: redactedData } = redactCredentials(patch.data)
    const updated = { ...session, data: { ...session.data, ...redactedData } }
    this.#sessions.set(key, updated)
    return updated
  }

  archiveSession(credId: string, sessionId: string): Session {
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

  appendEntry(input: NewSessionEntry): SessionEntry {
    const sessionKey = this.#sessionKey(input.credId, input.sessionId)
    const session = this.#sessions.get(sessionKey)
    if (!session) {
      throw new SessionStoreError('session_not_found', `session not found: ${input.sessionId}`)
    }
    const timestamp = Math.max(
      this.#now().getTime(),
      session.lastEntryAt === null ? 0 : Date.parse(session.lastEntryAt) + 1,
    )
    const effectiveTtlDays = resolveEntryTtlDays(this.#retention, session.data)
    const { expiresAt } = computeEntryExpiry(timestamp, effectiveTtlDays)
    const { value: redactedData } = redactCredentials(input.data)
    const entry: SessionEntry = {
      sessionId: input.sessionId,
      createdAt: new Date(timestamp).toISOString(),
      data: redactedData,
      ...(input.schemaId !== undefined ? { schemaId: input.schemaId } : {}),
      ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
      expiresAt,
    }
    this.#entries.set(this.#entryKey(input.credId, input.sessionId, timestamp), entry)
    this.#sessions.set(sessionKey, { ...session, lastEntryAt: entry.createdAt })
    return entry
  }

  async *getEntries(
    credId: string,
    sessionId: string,
    options: GetEntriesOptions = {},
  ): AsyncIterable<SessionEntry> {
    if (!options.sessionVerified && !this.#sessions.has(this.#sessionKey(credId, sessionId))) {
      throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
    }
    const prefix = `${credId} ${sessionId} `
    for (const [key, entry] of this.#entries) {
      if (key.startsWith(prefix)) yield entry
    }
  }

  #sessionKey(credId: string, sessionId: string): string {
    return `${credId} ${sessionId}`
  }

  #entryKey(credId: string, sessionId: string, timestamp: number): string {
    return `${credId} ${sessionId} ${new Date(timestamp).toISOString()}`
  }
}
