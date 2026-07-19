import { requestJson } from './http.mjs'
import type { ClientConfig, CreateSessionInput, Session } from './types.mjs'

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

  list(): Promise<Session[]> {
    return requestJson(this.#config, '/sessions', { method: 'GET' })
  }

  get(sessionId: string): Promise<Session> {
    return requestJson(this.#config, `/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
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
