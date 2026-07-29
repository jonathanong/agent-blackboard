import { requestJson } from './http.mjs'
import type {
  ClientConfig,
  CreateSessionInput,
  ListSessionsQuery,
  ListSessionsResult,
  PatchSessionInput,
  Session,
} from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** Converts a typed `listSessions` query into wire-format string params. */
function buildListSessionsQuery(query: ListSessionsQuery): Record<string, string> {
  const wire: Record<string, string> = {}
  if (query.archived !== undefined) wire.archived = String(query.archived)
  if (query.agent !== undefined) wire.agent = query.agent
  if (query.version !== undefined) wire.version = query.version
  if (query.parentSessionId !== undefined) {
    wire.parentSessionId = query.parentSessionId ?? ''
  }
  if (query.data !== undefined) wire.data = JSON.stringify(query.data)
  if (query.inactiveForHours !== undefined) {
    wire.inactiveForHours = String(query.inactiveForHours)
  }
  if (query.limit !== undefined) wire.limit = String(query.limit)
  if (query.cursor !== undefined) wire.cursor = query.cursor
  return wire
}

export class Sessions {
  readonly #config: ClientConfig

  constructor(config: ClientConfig) {
    this.#config = config
  }

  create(input: CreateSessionInput): Promise<Session> {
    return requestJson(this.#config, '/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    })
  }

  list(query: ListSessionsQuery = {}): Promise<ListSessionsResult> {
    return requestJson(this.#config, '/sessions', {
      method: 'GET',
      query: buildListSessionsQuery(query),
    })
  }

  get(sessionId: string): Promise<Session> {
    return requestJson(this.#config, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
    })
  }

  patch(input: PatchSessionInput): Promise<Session> {
    return requestJson(this.#config, `/sessions/${encodeURIComponent(input.sessionId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ data: input.data }),
    })
  }

  archive(sessionId: string): Promise<Session> {
    return requestJson(this.#config, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ archived: true }),
    })
  }
}
