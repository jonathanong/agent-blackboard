import { isDeepStrictEqual } from 'node:util'
import type { Session } from '../core/types.mjs'
import type { ListSessionsQuery } from './store.mjs'
import type { SessionCursorKey } from './session-cursor.mjs'

function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Orders sessions by creation time, tiebroken by id (code-point order). */
export function sortSessions(sessions: Session[]): void {
  sessions.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    return compareStrings(a.id, b.id)
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

function matchesData(session: Session, data: Record<string, unknown> | undefined): boolean {
  if (data === undefined) return true
  return Object.entries(data).every(([dataKey, value]) =>
    isDeepStrictEqual(session.data[dataKey], value),
  )
}

function matchesInactivity(session: Session, hours: number | undefined, now: Date): boolean {
  if (hours === undefined) return true
  if (session.lastEntryAt === null) return false
  const cutoff = now.getTime() - hours * 60 * 60 * 1000
  return Date.parse(session.lastEntryAt) < cutoff
}

export function matchesListFilter(
  session: Session,
  query: ListSessionsQuery,
  now: Date = new Date(),
): boolean {
  if (query.archived !== undefined && (session.archivedAt !== null) !== query.archived) {
    return false
  }
  if (query.agent !== undefined && session.agent !== query.agent) return false
  if (query.version !== undefined && session.version !== query.version) return false
  if (query.parentSessionId !== undefined && session.parentSessionId !== query.parentSessionId) {
    return false
  }
  return matchesData(session, query.data) && matchesInactivity(session, query.inactiveForHours, now)
}
