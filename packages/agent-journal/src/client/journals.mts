import { appendEntry, appendEntriesBatch } from './append.mjs'
import { patchEntries } from './patch.mjs'
import { streamEntries } from './stream.mjs'
import type { AppendInput, ClientConfig, GetEntriesQuery, JournalEntry, PatchOp } from './types.mjs'

/**
 * Cross-session journal operations — batch append, filtered reads across
 * sessions/agents, and archive/data patches. Use this instead of `Journal`
 * when you're not bound to one session (e.g. a distill pass over a
 * credential's whole history).
 */
export class Journals {
  readonly #config: ClientConfig

  constructor(options: ClientConfig) {
    this.#config = options
  }

  /** Appends one entry, or a batch — mirrors what `POST /journals` accepts. */
  append(input: AppendInput): Promise<JournalEntry>
  append(input: AppendInput[]): Promise<JournalEntry[]>
  append(input: AppendInput | AppendInput[]): Promise<JournalEntry | JournalEntry[]> {
    return Array.isArray(input)
      ? appendEntriesBatch(this.#config, input)
      : appendEntry(this.#config, input)
  }

  /** Reads entries across sessions/agents, streaming as they arrive. */
  get(query: GetEntriesQuery = {}): AsyncIterable<JournalEntry> {
    return streamEntries(this.#config, query)
  }

  /** Batch-patches entries by id; `data` is a shallow merge, not a replace. */
  async patch(patches: PatchOp[]): Promise<JournalEntry[]> {
    return patchEntries(this.#config, patches)
  }
}
