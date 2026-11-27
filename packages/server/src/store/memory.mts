import type {
  CredentialRecord,
  SchemaBundle,
  SchemaShadowReport,
  Session,
  SessionEntry,
} from '../core/types.mjs'
import { MemoryCredentialStore } from './memory-credentials.mjs'
import { MemorySchemaShadowStore } from './memory-schemas-shadow.mjs'
import { MemorySchemaStore } from './memory-schemas.mjs'
import { MemorySessionStore } from './memory-sessions.mjs'
import type {
  BlackboardStore,
  CredentialIdOrName,
  DeprecateSchemaResult,
  GetEntriesOptions,
  GetSchemaResult,
  GetSchemaShadowReportOptions,
  ListSchemaVersionsResult,
  ListSchemasResult,
  ListSessionsQuery,
  ListSessionsResult,
  NewSession,
  NewSessionEntry,
  PromoteSchemaVersionResult,
  PutSchemaVersionInput,
  PutSchemaVersionResult,
  RecordSchemaShadowFailureInput,
  SessionPatch,
} from './store.mjs'

export interface MemoryStoreOptions {
  now?: () => Date
}

/** In-memory `BlackboardStore` for unit tests and local dev. */
export class MemoryBlackboardStore implements BlackboardStore {
  readonly #now: () => Date
  readonly #sessions: MemorySessionStore
  readonly #credentials: MemoryCredentialStore
  readonly #schemas: MemorySchemaStore
  readonly #shadow = new MemorySchemaShadowStore()

  constructor(options: MemoryStoreOptions = {}) {
    const now = options.now ?? ((): Date => new Date())
    this.#now = now
    this.#sessions = new MemorySessionStore(now)
    this.#credentials = new MemoryCredentialStore(now)
    this.#schemas = new MemorySchemaStore(now)
  }

  async createSession(input: NewSession): Promise<Session> {
    return this.#sessions.createSession(input)
  }

  async getSession(credId: string, sessionId: string): Promise<Session | undefined> {
    return this.#sessions.getSession(credId, sessionId)
  }

  async listSessions(credId: string, query?: ListSessionsQuery): Promise<ListSessionsResult> {
    return this.#sessions.listSessions(credId, query)
  }

  async patchSession(credId: string, patch: SessionPatch): Promise<Session> {
    return this.#sessions.patchSession(credId, patch)
  }

  async archiveSession(credId: string, sessionId: string): Promise<Session> {
    return this.#sessions.archiveSession(credId, sessionId)
  }

  async appendEntry(input: NewSessionEntry): Promise<SessionEntry> {
    return this.#sessions.appendEntry(input)
  }

  getEntries(
    credId: string,
    sessionId: string,
    options?: GetEntriesOptions,
  ): AsyncIterable<SessionEntry> {
    return this.#sessions.getEntries(credId, sessionId, options)
  }

  async createCredential(name: string): Promise<{ record: CredentialRecord; token: string }> {
    return this.#credentials.create(name)
  }

  async listCredentials(): Promise<CredentialRecord[]> {
    return this.#credentials.list()
  }

  async getCredentialById(id: string): Promise<CredentialRecord | undefined> {
    return this.#credentials.getById(id)
  }

  async deleteCredential(idOrName: CredentialIdOrName): Promise<boolean> {
    return this.#credentials.delete(idOrName)
  }

  async getSchemaRegistryRevision(): Promise<number> {
    return this.#schemas.getRevision()
  }

  async putSchemaVersion(input: PutSchemaVersionInput): Promise<PutSchemaVersionResult> {
    return this.#schemas.putSchemaVersion(input)
  }

  async promoteSchemaVersion(
    id: string,
    version: number,
    actor: string,
  ): Promise<PromoteSchemaVersionResult> {
    return this.#schemas.promoteSchemaVersion(id, version, actor)
  }

  async deprecateSchema(id: string, actor: string): Promise<DeprecateSchemaResult> {
    return this.#schemas.deprecateSchema(id, actor)
  }

  async listSchemas(): Promise<ListSchemasResult> {
    return this.#schemas.listSchemas()
  }

  async getSchema(id: string, version?: number): Promise<GetSchemaResult | undefined> {
    return this.#schemas.getSchema(id, version)
  }

  async listSchemaVersions(id: string): Promise<ListSchemaVersionsResult | undefined> {
    return this.#schemas.listSchemaVersions(id)
  }

  async getSchemaBundle(): Promise<SchemaBundle> {
    return this.#schemas.getSchemaBundle()
  }

  async recordSchemaShadowFailure(input: RecordSchemaShadowFailureInput): Promise<void> {
    this.#shadow.record(input, this.#now().toISOString())
  }

  async getSchemaShadowReport(
    id: string,
    options: GetSchemaShadowReportOptions = {},
  ): Promise<SchemaShadowReport | undefined> {
    const listed = this.#schemas.listSchemaVersions(id)
    if (!listed) return undefined
    const selected =
      options.version === undefined
        ? listed.versions
        : listed.versions.filter((v) => v.version === options.version)
    if (options.version !== undefined && selected.length === 0) return undefined
    return this.#shadow.buildReport(id, listed.revision, selected, options.version, options.limit)
  }
}
