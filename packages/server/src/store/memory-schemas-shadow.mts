import type {
  SchemaShadowFailureRecord,
  SchemaShadowReport,
  SchemaShadowVersionCount,
  SchemaVersionRecord,
} from '../core/types.mjs'
import { DEFAULT_SHADOW_REPORT_LIMIT, type RecordSchemaShadowFailureInput } from './store.mjs'

interface VersionShadowBucket {
  failureCount: number
  lastFailureAt: string | null
  failures: SchemaShadowFailureRecord[]
}

/** In-memory shadow failure counter and event log used by `MemorySchemaStore`. */
export class MemorySchemaShadowStore {
  readonly #buckets = new Map<string, VersionShadowBucket>()

  #key(id: string, version: number): string {
    return `${id}@${version}`
  }

  record(input: RecordSchemaShadowFailureInput, occurredAt: string): void {
    const key = this.#key(input.schemaId, input.schemaVersion)
    const bucket = this.#buckets.get(key) ?? { failureCount: 0, lastFailureAt: null, failures: [] }
    bucket.failureCount += 1
    bucket.lastFailureAt = occurredAt
    bucket.failures.push({
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion,
      sessionId: input.sessionId,
      occurredAt,
      code: input.code,
      message: input.message,
      details: structuredClone(input.details),
    })
    this.#buckets.set(key, bucket)
  }

  buildReport(
    id: string,
    revision: number,
    versionRecords: SchemaVersionRecord[],
    targetVersion: number | undefined,
    limit = DEFAULT_SHADOW_REPORT_LIMIT,
  ): SchemaShadowReport {
    let totalFailures = 0
    const versions: SchemaShadowVersionCount[] = []
    const collected: SchemaShadowFailureRecord[] = []
    for (const record of versionRecords) {
      const bucket = this.#buckets.get(this.#key(id, record.version))
      const failureCount = bucket?.failureCount ?? 0
      totalFailures += failureCount
      versions.push({
        version: record.version,
        ref: record.ref,
        mode: record.mode,
        failureCount,
        lastFailureAt: bucket?.lastFailureAt ?? null,
      })
      if (bucket) {
        for (const failure of bucket.failures) {
          collected.push({ ...failure, details: structuredClone(failure.details) })
        }
      }
    }
    const recentFailures = collected
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.schemaVersion - a.schemaVersion)
      .slice(0, limit)
    return {
      id,
      version: targetVersion ?? null,
      totalFailures,
      versions,
      recentFailures,
      revision,
    }
  }
}
