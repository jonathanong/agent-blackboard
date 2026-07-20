import { MAX_SESSIONS_LIMIT, type ListSessionsQuery } from '../../store/store.mjs'
import type { QueryMap } from '../types.mjs'
import { objectData } from './sessions.mjs'

export type ListSessionsQueryResult =
  | { ok: true; query: ListSessionsQuery }
  | { ok: false; error: string }

/**
 * Parses `GET /sessions` query params into a `ListSessionsQuery`. A bare
 * request (no `archived` param) defaults to `archived: false` — this must
 * keep matching the pre-pagination behavior exactly, not fall back to "no
 * filter".
 */
export function parseListSessionsQuery(query: QueryMap): ListSessionsQueryResult {
  const result: ListSessionsQuery = {}

  const archivedRaw = query.archived ?? 'false'
  if (archivedRaw !== 'true' && archivedRaw !== 'false') {
    return { ok: false, error: 'archived must be true or false' }
  }
  result.archived = archivedRaw === 'true'

  if (query.agent !== undefined) result.agent = query.agent
  if (query.version !== undefined) result.version = query.version

  if (Object.hasOwn(query, 'parentSessionId')) {
    const raw = query.parentSessionId
    result.parentSessionId = raw === undefined || raw === '' ? null : raw
  }

  if (query.data !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(query.data)
    } catch {
      return { ok: false, error: 'data must be a JSON object' }
    }
    const data = objectData(parsed)
    if (!data) return { ok: false, error: 'data must be a JSON object' }
    result.data = data
  }

  if (query.limit !== undefined) {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SESSIONS_LIMIT) {
      return { ok: false, error: `limit must be an integer between 1 and ${MAX_SESSIONS_LIMIT}` }
    }
    result.limit = limit
  }

  if (query.cursor !== undefined) result.cursor = query.cursor

  return { ok: true, query: result }
}
