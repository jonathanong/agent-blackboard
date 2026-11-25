import type { CredentialRecord, SchemaBundle, Session, SessionEntry } from '../core/types.mjs'
import { MemoryCredentialStore } from './memory-credentials.mjs'
import { MemorySchemaStore } from './memory-schemas.mjs'
import { MemorySessionStore } from './memory-sessions.mjs'
import type {
  BlackboardStore,
  CredentialIdOrName,
  DeprecateSchemaResult,
  GetEntriesOptions,
  GetSchemaResult,
  ListSchemaVersionsResult,
  ListSchemasResult,
  ListSessionsQuery,
  ListSessionsResult,
  NewSession,
  NewSessionEntry,
  PutSchemaVersionInput,
  PutSchemaVersionResult,
  SessionPatch,
} from './store.mjs'

export interface MemoryStoreOptions {
  now?: () => Date
}

/** In-memory `BlackboardStore` for unit tests and local dev. */
export class MemoryBlackboardStore implements BlackboardStore {
  readonly #sessions: MemorySessionStore
  readonly #credentials: MemoryCredentialStore
  readonly #schemas: MemorySchemaStore

  constructor(options: MemoryStoreOptions = {}) {
    const now = options.now ?? ((): Date => new Date())
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
}
