import { isDeepStrictEqual } from 'node:util'
import { AgentBlackboardError } from '../client/errors.mjs'
import { Sessions } from '../client/sessions.mjs'
import { expectObject, nullableString, optionalPositiveInt, requiredString } from './validate.mjs'
import type { ClientConfig, ListSessionsQuery, Session } from '../client/types.mjs'

/** Parsed, validated `session_search` args, shared by the direct-get and list paths. */
interface SessionSearchArgs {
  archived: boolean
  limit: number | undefined
  cursor: string | undefined
  hasParent: boolean
  parentSessionId: string | null | undefined
  agent: string | undefined
  version: string | undefined
  data: Record<string, unknown> | undefined
}

function parseSessionSearchArgs(args: Record<string, unknown>): SessionSearchArgs {
  if (args.archived !== undefined && args.archived !== 0 && args.archived !== 1) {
    throw new Error('"archived" must be 0 or 1.')
  }
  const hasParent = Object.hasOwn(args, 'parentSessionId')
  return {
    archived: args.archived === 1,
    limit: optionalPositiveInt(args.limit, 'limit'),
    cursor: args.cursor === undefined ? undefined : requiredString(args.cursor, 'cursor'),
    hasParent,
    parentSessionId: hasParent
      ? nullableString(args.parentSessionId, 'parentSessionId')
      : undefined,
    agent: args.agent === undefined ? undefined : requiredString(args.agent, 'agent'),
    version: args.version === undefined ? undefined : requiredString(args.version, 'version'),
    data: args.data === undefined ? undefined : expectObject(args.data, 'data'),
  }
}

/** Whether a single directly-fetched session satisfies every supplied `session_search` filter. */
function matchesDirectSession(session: Session, parsed: SessionSearchArgs): boolean {
  if ((session.archivedAt !== null) !== parsed.archived) return false
  if (parsed.hasParent && session.parentSessionId !== parsed.parentSessionId) return false
  if (parsed.agent !== undefined && session.agent !== parsed.agent) return false
  if (parsed.version !== undefined && session.version !== parsed.version) return false
  if (parsed.data !== undefined) {
    for (const [key, value] of Object.entries(parsed.data)) {
      if (!isDeepStrictEqual(session.data[key], value)) return false
    }
  }
  return true
}

/**
 * `sessionId` is not a server-side `ListSessionsQuery` filter (on DynamoDB that would be a PK
 * lookup disguised as a scan filter), so a `sessionId`-scoped search is a direct `Sessions.get()`
 * instead of a list call, with the remaining filters applied in-process to that one session.
 */
async function searchBySessionId(
  sessionId: string,
  config: ClientConfig,
  parsed: SessionSearchArgs,
): Promise<{ sessions: Session[]; nextCursor: string | null }> {
  let session: Session | null
  try {
    session = await new Sessions(config).get(sessionId)
  } catch (error) {
    if (error instanceof AgentBlackboardError && error.status === 404) session = null
    else throw error
  }
  const matches = session !== null && matchesDirectSession(session, parsed)
  return { sessions: matches ? [session as Session] : [], nextCursor: null }
}

export async function handleSessionSearch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ sessions: Session[]; nextCursor: string | null }> {
  const parsed = parseSessionSearchArgs(args)

  if (args.sessionId !== undefined) {
    const sessionId = requiredString(args.sessionId, 'sessionId')
    return searchBySessionId(sessionId, config, parsed)
  }

  const query: ListSessionsQuery = { archived: parsed.archived }
  if (parsed.hasParent) query.parentSessionId = parsed.parentSessionId ?? null
  if (parsed.agent !== undefined) query.agent = parsed.agent
  if (parsed.version !== undefined) query.version = parsed.version
  if (parsed.data !== undefined) query.data = parsed.data
  if (parsed.limit !== undefined) query.limit = parsed.limit
  if (parsed.cursor !== undefined) query.cursor = parsed.cursor
  return new Sessions(config).list(query)
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
