import { isDeepStrictEqual } from 'node:util'
import type { Session } from '../core/types.mjs'
import type { ListSessionsQuery } from './store.mjs'
import type { SessionCursorKey } from './session-cursor.mjs'

/** Orders sessions by creation time, tiebroken by id (code-point order). */
export function sortSessions(sessions: Session[]): void {
  sessions.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Index of the first session strictly after `key` in a `sortSessions`-ordered
 * array, or -1 if none. Uses the same (createdAt, id) ordering as
 * `sortSessions` so cursor resume never disagrees with the sort.
 */
export function resumeIndex(sorted: Session[], key: SessionCursorKey): number {
  return sorted.findIndex((session) => {
    if (session.createdAt !== key.createdAt) return session.createdAt > key.createdAt
    return session.id > key.sessionId
  })
}

export function matchesListFilter(session: Session, query: ListSessionsQuery): boolean {
  if (query.archived !== undefined && (session.archivedAt !== null) !== query.archived) {
    return false
  }
  if (query.agent !== undefined && session.agent !== query.agent) return false
  if (query.version !== undefined && session.version !== query.version) return false
  if (query.parentSessionId !== undefined && session.parentSessionId !== query.parentSessionId) {
    return false
  }
  if (query.data) {
    for (const [dataKey, value] of Object.entries(query.data)) {
      if (!isDeepStrictEqual(session.data[dataKey], value)) return false
    }
  }
  return true
}
