import type { AppendedSessionEntry, SessionEntry } from '../core/types.mjs'
import { entryContentHash, sourceEventConflictError } from './source-event.mjs'
import type { NewSessionEntry } from './store.mjs'

/** Per-session `sourceEventId` idempotency index for `MemorySessionStore`. */
export class MemorySourceEventIndex {
  readonly #records = new Map<string, { contentHash: string; entry: SessionEntry }>()

  resolve(
    credId: string,
    sessionId: string,
    sourceEventId: string,
    contentHash: string,
  ): AppendedSessionEntry | undefined {
    const existing = this.#records.get(this.#key(credId, sessionId, sourceEventId))
    if (!existing) return undefined
    if (existing.contentHash !== contentHash) {
      throw sourceEventConflictError(sessionId, existing.entry.createdAt, sourceEventId)
    }
    return { ...structuredClone(existing.entry), duplicate: true }
  }

  prepare(
    input: NewSessionEntry,
    redactedData: Record<string, unknown>,
  ): { contentHash?: string; existing?: AppendedSessionEntry } {
    if (input.sourceEventId === undefined) return {}
    const contentHash =
      input.sourceEventContentHash ??
      entryContentHash({
        data: redactedData,
        schemaId: input.schemaId,
        schemaVersion: input.schemaVersion,
      })
    const existing = this.resolve(input.credId, input.sessionId, input.sourceEventId, contentHash)
    return existing ? { contentHash, existing } : { contentHash }
  }

  record(input: NewSessionEntry, contentHash: string | undefined, entry: SessionEntry): void {
    if (input.sourceEventId === undefined) return
    this.#records.set(this.#key(input.credId, input.sessionId, input.sourceEventId), {
      contentHash: contentHash!,
      entry: structuredClone(entry),
    })
  }

  #key(credId: string, sessionId: string, sourceEventId: string): string {
    return `${credId}\0${sessionId}\0${sourceEventId}`
  }
}
