import type { CredentialRecord, TelemetryEntry } from '../core/types.mjs'

/** Body accepted by `appendEntry` — `credId` comes from the resolved auth credential, not the request body. */
export interface NewTelemetryEntry {
  credId: string
  sessionId: string
  agent: string
  data: Record<string, unknown>
}

export interface EntryFilter {
  sessionId?: string
  agent?: string
  archived?: boolean
}

/**
 * One patch in a `patchEntries` batch. `data` MERGES into the existing data
 * blob (shallow merge at the top level). Callers (the HTTP layer) must
 * ensure each patch sets at least one of `archived`/non-empty `data` —
 * store implementations assume this and don't handle a fully-empty patch.
 */
export interface EntryPatch {
  id: string
  archived?: boolean
  data?: Record<string, unknown>
}

export interface CredentialIdOrName {
  id?: string
  name?: string
}

/**
 * Hard cap on one `appendEntries` batch — matches DynamoDB's own
 * `TransactWriteItems` limit of 100 items per transaction, which the
 * DynamoDB-backed store relies on for atomicity. The HTTP layer rejects
 * (400) a batch larger than this before it ever reaches the store.
 */
export const MAX_APPEND_BATCH_SIZE = 100

/**
 * Framework-agnostic telemetry storage interface. All methods are async so a
 * DynamoDB-backed implementation and an in-memory test double can share one
 * contract. `getEntries` streams/paginates internally rather than buffering
 * a full result set — implementations must not load an entire table/session
 * into memory before yielding the first entry.
 */
export interface TelemetryStore {
  appendEntry(entry: NewTelemetryEntry): Promise<TelemetryEntry>

  /**
   * Appends every entry atomically — all succeed or none do. This is the
   * fix for a real failure mode: sequential independent per-entry writes
   * mean a partial failure (or a timeout) can leave an unknown prefix of
   * the batch committed, and a client retry with fresh ids then duplicates
   * that prefix. Bounded to `MAX_APPEND_BATCH_SIZE` entries — callers must
   * enforce this before calling (the store may also enforce it defensively).
   */
  appendEntries(entries: NewTelemetryEntry[]): Promise<TelemetryEntry[]>

  /** Entries for one credential, optionally narrowed by session/agent/archived. Newest-appended-last within a session is NOT guaranteed by this interface beyond insertion order. */
  getEntries(credId: string, filter: EntryFilter): AsyncIterable<TelemetryEntry>

  /** Merges each patch into its entry; patches for unknown ids are silently skipped (not included in the result). */
  patchEntries(credId: string, patches: EntryPatch[]): Promise<TelemetryEntry[]>

  createCredential(name: string): Promise<{ record: CredentialRecord; token: string }>

  listCredentials(): Promise<CredentialRecord[]>

  getCredentialById(id: string): Promise<CredentialRecord | undefined>

  /** Deletes by `id` if given, else deletes ALL credentials matching `name` (names are not unique). Returns whether anything was deleted. */
  deleteCredential(idOrName: CredentialIdOrName): Promise<boolean>
}
