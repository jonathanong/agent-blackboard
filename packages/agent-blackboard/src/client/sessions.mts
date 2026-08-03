import { AgentBlackboardError } from './errors.mjs'
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

export interface EnsureSessionResult {
  status: 'created' | 'exists'
  session: Session
}

/** Fields compared against an existing session when a `create` conflicts. */
const COMPARED_FIELDS = ['parentSessionId', 'agent', 'version'] as const

function fieldMismatches(input: CreateSessionInput, existing: Session): string[] {
  const mismatches: string[] = []
  for (const field of COMPARED_FIELDS) {
    const expected = input[field] ?? null
    const actual = existing[field] ?? null
    if (expected !== actual) {
      mismatches.push(
        `${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      )
    }
  }
  return mismatches
}

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

  /**
   * Idempotent `create`: a 409 (session already exists) is treated as success
   * only when the existing session's `parentSessionId`/`agent`/`version` match
   * `input` exactly; any other mismatch or error propagates.
   */
  async ensure(input: CreateSessionInput): Promise<EnsureSessionResult> {
    try {
      const session = await this.create(input)
      return { status: 'created', session }
    } catch (error) {
      if (!(error instanceof AgentBlackboardError) || error.status !== 409) throw error
      const existing = await this.get(input.id)
      const mismatches = fieldMismatches(input, existing)
      if (mismatches.length > 0) {
        throw new Error(
          `session ${input.id} exists with different fields: ${mismatches.join('; ')}`,
        )
      }
      return { status: 'exists', session: existing }
    }
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
