import { appendEntry } from './append.mjs'
import { streamEntries } from './stream.mjs'
import type { AppendEntryInput, ClientConfig, GetEntriesQuery, SessionEntry } from './types.mjs'

export class Entries {
  readonly #config: ClientConfig

  constructor(config: ClientConfig) {
    this.#config = config
  }

  append(input: AppendEntryInput): Promise<SessionEntry> {
    return appendEntry(this.#config, input)
  }

  get(query: GetEntriesQuery): AsyncIterable<SessionEntry> {
    return streamEntries(this.#config, query)
  }
}
