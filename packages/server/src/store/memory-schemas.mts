import type { SchemaBundle, SchemaRecord, SchemaVersionRecord } from '../core/types.mjs'
import { formatSchemaRef } from '../schemas/id.mjs'
import { SessionStoreError } from './errors.mjs'
import type {
  DeprecateSchemaResult,
  GetSchemaResult,
  ListSchemasResult,
  ListSchemaVersionsResult,
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
      createdAt: timestamp,
      createdBy: input.actor,
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
