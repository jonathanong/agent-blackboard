import { isDeepStrictEqual } from 'node:util'
import { Sessions } from '../client/sessions.mjs'
import { expectObject, nullableString, requiredString } from './validate.mjs'
import type { ClientConfig, Session } from '../client/types.mjs'

interface SessionSearchFilters {
  sessionId?: string
  parentSessionId?: { value: string | null }
  agent?: string
  version?: string
  data?: Record<string, unknown>
}

function matchesSession(session: Session, filters: SessionSearchFilters): boolean {
  if (filters.sessionId !== undefined && session.id !== filters.sessionId) return false
  if (filters.parentSessionId && session.parentSessionId !== filters.parentSessionId.value)
    return false
  if (filters.agent !== undefined && session.agent !== filters.agent) return false
  if (filters.version !== undefined && session.version !== filters.version) return false
  if (filters.data) {
    for (const [key, value] of Object.entries(filters.data)) {
      if (!isDeepStrictEqual(session.data[key], value)) return false
    }
  }
  return true
}

export async function handleSessionSearch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ sessions: Session[] }> {
  if (args.archived !== undefined && args.archived !== 0 && args.archived !== 1) {
    throw new Error('"archived" must be 0 or 1.')
  }
  const hasParent = Object.hasOwn(args, 'parentSessionId')
  const filters: SessionSearchFilters = {
    ...(args.sessionId === undefined
      ? {}
      : { sessionId: requiredString(args.sessionId, 'sessionId') }),
    ...(hasParent
      ? { parentSessionId: { value: nullableString(args.parentSessionId, 'parentSessionId') } }
      : {}),
    ...(args.agent === undefined ? {} : { agent: requiredString(args.agent, 'agent') }),
    ...(args.version === undefined ? {} : { version: requiredString(args.version, 'version') }),
    ...(args.data === undefined ? {} : { data: expectObject(args.data, 'data') }),
  }
  const sessions = await new Sessions(config).list({ archived: args.archived === 1 })
  return { sessions: sessions.filter((session) => matchesSession(session, filters)) }
}

export function handleSessionCreate(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  return new Sessions(config).create({
    id: requiredString(args.sessionId, 'sessionId'),
    parentSessionId: nullableString(args.parentSessionId, 'parentSessionId'),
    agent: requiredString(args.agent, 'agent'),
    version: requiredString(args.version, 'version'),
  })
}

export function handleSessionPatch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  const data = expectObject(args.data, 'data')
  if (Object.keys(data).length === 0) throw new Error('data must be a non-empty object')
  return new Sessions(config).patch({
    sessionId: requiredString(args.sessionId, 'sessionId'),
    data,
  })
}

export function handleSessionArchive(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  return new Sessions(config).archive(requiredString(args.sessionId, 'sessionId'))
}
