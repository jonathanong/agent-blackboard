import { resolveClientCredential } from '../../auth/client.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import {
  errorResponse,
  notFoundResponse,
  streamResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { parseListSessionsQuery } from './sessions-query.mjs'
import { streamSnapshot, type SnapshotSelection } from './snapshot-stream.mjs'

function selection(request: HandlerRequest): SnapshotSelection | { error: string } {
  const parsed = parseListSessionsQuery(request.query)
  if (!parsed.ok) return { error: parsed.error }
  const query = parsed.query
  return {
    archived: false,
    ...(query.agent === undefined ? {} : { agent: query.agent }),
    ...(query.version === undefined ? {} : { version: query.version }),
    ...(query.parentSessionId === undefined ? {} : { parentSessionId: query.parentSessionId }),
    ...(query.data === undefined ? {} : { data: query.data }),
    ...(query.inactiveForHours === undefined ? {} : { inactiveForHours: query.inactiveForHours }),
  }
}

export function handleSnapshotRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  now: () => Date = () => new Date(),
): Promise<HandlerResponse> {
  return (async () => {
    const cred = await resolveClientCredential(request.headers.authorization, store)
    if (!cred) return unauthorizedResponse()
    if (request.method !== 'GET') return notFoundResponse()
    const parsed = selection(request)
    if ('error' in parsed) return errorResponse(400, parsed.error)
    return streamResponse(200, 'application/x-ndjson', streamSnapshot(store, cred.id, parsed, now))
  })()
}
