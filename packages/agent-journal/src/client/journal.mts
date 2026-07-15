import { appendEntry } from './append.mjs'
import { streamEntries } from './stream.mjs'
import { resolveSessionId } from '../session.mjs'
import type { GetEntriesQuery, JournalEntry } from './types.mjs'

const DEFAULT_AGENT = 'claude-code'

export interface JournalOptions {
  baseUrl: string
  token: string
  /** Explicit session id; falls back through `resolveSessionId` if omitted. */
  sessionId?: string
  /** Agent identifier attached to every entry. Defaults to `'claude-code'`. */
  agent?: string
}

export type JournalGetOptions = Omit<GetEntriesQuery, 'sessionId' | 'agent'>

/**
 * A journal bound to one session + agent — the ergonomic entry point for
 * "record what I'm doing, then read it back later."
 */
export class Journal {
  readonly sessionId: string
  readonly agent: string
  readonly #config: { baseUrl: string; token: string }

  constructor(options: JournalOptions) {
    this.#config = { baseUrl: options.baseUrl, token: options.token }
    this.sessionId = resolveSessionId(options.sessionId)
    this.agent = options.agent ?? DEFAULT_AGENT
  }

  /** Appends one unstructured entry to this session's journal. */
  async append(data: Record<string, unknown>): Promise<JournalEntry> {
    return appendEntry(this.#config, {
      sessionId: this.sessionId,
      agent: this.agent,
      data,
    })
  }

  /** Reads this session's journal back, streaming entries as they arrive. */
  get(options: JournalGetOptions = {}): AsyncIterable<JournalEntry> {
    const query: GetEntriesQuery = { sessionId: this.sessionId, agent: this.agent }
    if (options.archived !== undefined) query.archived = options.archived
    if (options.format !== undefined) query.format = options.format
    return streamEntries(this.#config, query)
  }
}
