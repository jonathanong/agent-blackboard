import type { CredentialRecord, JournalEntry } from '../core/types.mjs'

/** Body accepted by `appendEntry` — `credId` comes from the resolved auth credential, not the request body. */
export interface NewJournalEntry {
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
 * Framework-agnostic journal storage interface. All methods are async so a
 * DynamoDB-backed implementation and an in-memory test double can share one
 * contract. `getEntries` streams/paginates internally rather than buffering
 * a full result set — implementations must not load an entire table/session
 * into memory before yielding the first entry.
 */
export interface JournalStore {
  appendEntry(entry: NewJournalEntry): Promise<JournalEntry>

  /** Entries for one credential, optionally narrowed by session/agent/archived. Newest-appended-last within a session is NOT guaranteed by this interface beyond insertion order. */
  getEntries(credId: string, filter: EntryFilter): AsyncIterable<JournalEntry>

  /** Merges each patch into its entry; patches for unknown ids are silently skipped (not included in the result). */
  patchEntries(credId: string, patches: EntryPatch[]): Promise<JournalEntry[]>

  createCredential(name: string): Promise<{ record: CredentialRecord; token: string }>

  listCredentials(): Promise<CredentialRecord[]>

  getCredentialById(id: string): Promise<CredentialRecord | undefined>

  /** Deletes by `id` if given, else deletes ALL credentials matching `name` (names are not unique). Returns whether anything was deleted. */
  deleteCredential(idOrName: CredentialIdOrName): Promise<boolean>
}
