import { requestJson } from './http.mjs'
import type {
  ClientConfig,
  CreateSessionInput,
  ListSessionsQuery,
  PatchSessionInput,
  Session,
} from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

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

  list(query: ListSessionsQuery = {}): Promise<Session[]> {
    const suffix = query.archived === undefined ? '' : `?archived=${String(query.archived)}`
    return requestJson(this.#config, `/sessions${suffix}`, { method: 'GET' })
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
