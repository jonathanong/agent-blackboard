import { appendEntry } from './append.mjs'
import { streamEntries } from './stream.mjs'
import { resolveSessionId } from '../session.mjs'
import type { GetEntriesQuery, TelemetryEntry } from './types.mjs'

const DEFAULT_AGENT = 'claude-code'

export interface TelemetryOptions {
  baseUrl: string
  token: string
  /** Explicit session id; falls back through `resolveSessionId` if omitted. */
  sessionId?: string
  /** Agent identifier attached to every entry. Defaults to `'claude-code'`. */
  agent?: string
}

export type TelemetryGetOptions = Omit<GetEntriesQuery, 'sessionId' | 'agent'>

/**
 * A telemetry stream bound to one session + agent — the ergonomic entry
 * point for "record what I'm doing, then read it back later."
 */
export class Telemetry {
  readonly sessionId: string
  readonly agent: string
  readonly #config: { baseUrl: string; token: string }

  constructor(options: TelemetryOptions) {
    this.#config = { baseUrl: options.baseUrl, token: options.token }
    this.sessionId = resolveSessionId(options.sessionId)
    this.agent = options.agent ?? DEFAULT_AGENT
  }

  /** Appends one unstructured entry to this session's telemetry stream. */
  async append(data: Record<string, unknown>): Promise<TelemetryEntry> {
    return appendEntry(this.#config, {
      sessionId: this.sessionId,
      agent: this.agent,
      data,
    })
  }

  /** Reads this session's telemetry back, streaming entries as they arrive. */
  get(options: TelemetryGetOptions = {}): AsyncIterable<TelemetryEntry> {
    const query: GetEntriesQuery = { sessionId: this.sessionId, agent: this.agent }
    if (options.archived !== undefined) query.archived = options.archived
    if (options.format !== undefined) query.format = options.format
    return streamEntries(this.#config, query)
  }
}
