import type { SchemaBundle, SchemaRecord, SchemaVersionRecord } from '../core/types.mjs'
import { formatSchemaRef } from '../schemas/id.mjs'
import { SessionStoreError } from './errors.mjs'
import type {
  DeprecateSchemaResult,
  GetSchemaResult,
  ListSchemasResult,
  ListSchemaVersionsResult,
  PromoteSchemaVersionResult,
  PutSchemaVersionInput,
  PutSchemaVersionResult,
} from './store.mjs'

/** In-memory schema registry store composed by `MemoryBlackboardStore`. */
export class MemorySchemaStore {
  #revision = 0
  readonly #summaries = new Map<string, SchemaRecord>()
  readonly #versions = new Map<string, SchemaVersionRecord[]>()
  readonly #now: () => Date

  constructor(now: () => Date) {
    this.#now = now
  }

  getRevision(): number {
    return this.#revision
  }

  putSchemaVersion(input: PutSchemaVersionInput): PutSchemaVersionResult {
    const existing = this.#summaries.get(input.id)
    if (existing?.deprecatedAt !== null && existing !== undefined) {
      throw new SessionStoreError('schema_deprecated', `schema is deprecated: ${input.id}`)
    }
    const currentVersion = existing?.latestVersion ?? 0
    if (currentVersion !== input.expectedVersion) {
      throw new SessionStoreError(
        'schema_conflict',
        `schema ${input.id} was modified concurrently (expected version ${input.expectedVersion}, found ${currentVersion})`,
      )
    }
    if (input.expectedRevision !== undefined && this.#revision !== input.expectedRevision) {
      throw new SessionStoreError(
        'schema_conflict',
        `schema registry changed concurrently (expected revision ${input.expectedRevision}, found ${this.#revision})`,
      )
    }
    const timestamp = this.#now().toISOString()
    const nextVersion = currentVersion + 1
    this.#revision += 1

    const summary: SchemaRecord = existing
      ? {
          ...existing,
          latestVersion: nextVersion,
          updatedAt: timestamp,
          updatedBy: input.actor,
        }
      : {
          id: input.id,
          latestVersion: nextVersion,
          deprecatedAt: null,
          deprecatedBy: null,
          createdAt: timestamp,
          createdBy: input.actor,
          updatedAt: timestamp,
          updatedBy: input.actor,
        }
    const versionRecord: SchemaVersionRecord = {
      id: input.id,
      version: nextVersion,
      ref: formatSchemaRef(input.id, nextVersion),
      schema: structuredClone(input.schema),
      mode: input.mode ?? 'enforced',
      createdAt: timestamp,
      createdBy: input.actor,
      promotedAt: null,
      promotedBy: null,
    }
    this.#summaries.set(input.id, summary)
    const list = this.#versions.get(input.id) ?? []
    list.push(versionRecord)
    this.#versions.set(input.id, list)
    return {
      revision: this.#revision,
      summary: { ...summary },
      versionRecord: { ...versionRecord, schema: structuredClone(versionRecord.schema) },
    }
  }

  promoteSchemaVersion(id: string, version: number, actor: string): PromoteSchemaVersionResult {
    const summary = this.#summaries.get(id)
    const versions = this.#versions.get(id)
    const index = versions?.findIndex((v) => v.version === version) ?? -1
    if (!summary || !versions || index < 0) {
      throw new SessionStoreError('schema_not_found', `schema version not found: ${id}@${version}`)
    }
    if (summary.deprecatedAt !== null) {
      throw new SessionStoreError('schema_deprecated', `schema is deprecated: ${id}`)
    }
    const existing = versions[index]!
    if (existing.mode === 'enforced') {
      return {
        revision: this.#revision,
        summary: { ...summary },
        versionRecord: { ...existing, schema: structuredClone(existing.schema) },
        alreadyEnforced: true,
      }
    }
    const timestamp = this.#now().toISOString()
    this.#revision += 1
    const updatedSummary: SchemaRecord = { ...summary, updatedAt: timestamp, updatedBy: actor }
    const updatedVersion: SchemaVersionRecord = {
      ...existing,
      mode: 'enforced',
      promotedAt: timestamp,
      promotedBy: actor,
    }
    this.#summaries.set(id, updatedSummary)
    versions[index] = updatedVersion
    return {
      revision: this.#revision,
      summary: { ...updatedSummary },
      versionRecord: { ...updatedVersion, schema: structuredClone(updatedVersion.schema) },
      alreadyEnforced: false,
    }
  }

  deprecateSchema(id: string, actor: string): DeprecateSchemaResult {
    const existing = this.#summaries.get(id)
    if (!existing) {
      throw new SessionStoreError('schema_not_found', `schema not found: ${id}`)
    }
    if (existing.deprecatedAt !== null) {
      return { revision: this.#revision, summary: { ...existing }, alreadyDeprecated: true }
    }
    const timestamp = this.#now().toISOString()
    this.#revision += 1
    const updated: SchemaRecord = {
      ...existing,
      deprecatedAt: timestamp,
      deprecatedBy: actor,
      updatedAt: timestamp,
      updatedBy: actor,
    }
    this.#summaries.set(id, updated)
    return { revision: this.#revision, summary: { ...updated }, alreadyDeprecated: false }
  }

  listSchemas(): ListSchemasResult {
    const schemas = [...this.#summaries.values()]
      .map((s) => ({ ...s }))
      .sort((a, b) => a.id.localeCompare(b.id))
    return { revision: this.#revision, schemas }
  }

  getSchema(id: string, version?: number): GetSchemaResult | undefined {
    const summary = this.#summaries.get(id)
    if (!summary) return undefined
    const targetVersion = version ?? summary.latestVersion
    const record = this.#versions.get(id)!.find((v) => v.version === targetVersion)
    if (!record) return undefined
    return {
      revision: this.#revision,
      summary: { ...summary },
      versionRecord: { ...record, schema: structuredClone(record.schema) },
    }
  }

  listSchemaVersions(id: string): ListSchemaVersionsResult | undefined {
    const summary = this.#summaries.get(id)
    if (!summary) return undefined
    const versions = this.#versions.get(id)!.map((v) => ({
      ...v,
      schema: structuredClone(v.schema),
    }))
    return { revision: this.#revision, summary: { ...summary }, versions }
  }

  getSchemaBundle(): SchemaBundle {
    const schemas = [...this.#summaries.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((summary) => ({
        ...summary,
        versions: this.#versions.get(summary.id)!.map((v) => ({
          ...v,
          schema: structuredClone(v.schema),
        })),
      }))
    return { revision: this.#revision, schemas }
  }
}
