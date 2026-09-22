import { MAX_SESSIONS_LIMIT, type ListSessionsQuery } from '../../store/store.mjs'
import type { QueryMap } from '../types.mjs'
import { objectData } from './sessions.mjs'

export type ListSessionsQueryResult =
  | { ok: true; query: ListSessionsQuery }
  | { ok: false; error: string }

type FieldResult<T> = { ok: true; value: T } | { ok: false }

/** Parses the `data` query param into an object filter, or fails if it isn't one. */
function parseDataParam(raw: string): FieldResult<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }
  const data = objectData(parsed)
  return data ? { ok: true, value: data } : { ok: false }
}

function parseDataArrayContainsParam(raw: string): FieldResult<Record<string, string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false }
  const entries = Object.entries(parsed)
  if (
    entries.length === 0 ||
    entries.some(
      ([key, value]) => key.length === 0 || typeof value !== 'string' || value.length === 0,
    )
  ) {
    return { ok: false }
  }
  return { ok: true, value: Object.fromEntries(entries) as Record<string, string> }
}

/** Parses the `limit` query param into a bounded integer, or fails if it isn't one. */
function parseLimitParam(raw: string): FieldResult<number> {
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SESSIONS_LIMIT) return { ok: false }
  return { ok: true, value: limit }
}

function parseInactiveForHours(raw: string): FieldResult<number> {
  const hours = Number(raw)
  if (!Number.isFinite(hours) || hours <= 0) return { ok: false }
  return { ok: true, value: hours }
}

function addDataFilter(query: QueryMap, result: ListSessionsQuery): string | undefined {
  if (query.data === undefined) return
  const parsed = parseDataParam(query.data)
  if (!parsed.ok) return 'data must be a JSON object'
  result.data = parsed.value
}

function addDataArrayContainsFilter(
  query: QueryMap,
  result: ListSessionsQuery,
): string | undefined {
  if (query.dataArrayContains === undefined) return
  const parsed = parseDataArrayContainsParam(query.dataArrayContains)
  if (!parsed.ok) return 'dataArrayContains must be a JSON object with string values'
  result.dataArrayContains = parsed.value
}

function addInactivityFilter(query: QueryMap, result: ListSessionsQuery): string | undefined {
  if (query.inactiveForHours === undefined) return
  const hours = parseInactiveForHours(query.inactiveForHours)
  if (!hours.ok) return 'inactiveForHours must be a positive number'
  result.inactiveForHours = hours.value
}

function addLimit(query: QueryMap, result: ListSessionsQuery): string | undefined {
  if (query.limit === undefined) return
  const limit = parseLimitParam(query.limit)
  if (!limit.ok) return `limit must be an integer between 1 and ${MAX_SESSIONS_LIMIT}`
  result.limit = limit.value
}

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

  const filterErrors = [
    addDataFilter(query, result),
    addDataArrayContainsFilter(query, result),
    addInactivityFilter(query, result),
    addLimit(query, result),
  ]
  for (const error of filterErrors) {
    if (error !== undefined) return { ok: false, error }
  }

  if (query.cursor !== undefined) result.cursor = query.cursor

  return { ok: true, query: result }
}
