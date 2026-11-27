import type { ValidateFunction } from 'ajv/dist/2020.js'
import type { SchemaBundle, SchemaVersionMode, SchemaVersionRecord } from '../core/types.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { compileRegisteredSchema } from './compile.mjs'
import { formatSchemaRef } from './id.mjs'

interface CompiledSchemaVersion {
  version: number
  mode: SchemaVersionMode
  validate: ValidateFunction
}

export type CachedLookup =
  | (CompiledSchemaVersion & {
      ok: true
      /** When an unpinned write resolves to a shadow version, the latest prior enforced version that still gates writes. */
      enforcedBaseline?: CompiledSchemaVersion
    })
  | { ok: false; code: string; error: string; deprecatedVersion?: number }

export interface StoreValidatorCache {
  revision: number
  bundle: SchemaBundle
  lookups: Map<string, CachedLookup>
}

const validatorCaches = new WeakMap<BlackboardStore, StoreValidatorCache>()

export async function getSnapshotCache(
  store: BlackboardStore,
  observedRevision: number,
): Promise<StoreValidatorCache> {
  const existing = validatorCaches.get(store)
  // Monotonic: never downgrade a cache already at a newer or equal revision.
  if (existing && existing.revision >= observedRevision) return existing
  const bundle = await store.getSchemaBundle()
  const latest = validatorCaches.get(store)
  if (latest && latest.revision >= bundle.revision) return latest
  const fresh: StoreValidatorCache = { revision: bundle.revision, bundle, lookups: new Map() }
  validatorCaches.set(store, fresh)
  return fresh
}

function compileVersionRecord(
  schemaId: string,
  record: SchemaVersionRecord,
  bundle: SchemaBundle,
): ({ ok: true } & CompiledSchemaVersion) | { ok: false; code: string; error: string } {
  const compiled = compileRegisteredSchema(
    { id: schemaId, version: record.version, schema: record.schema },
    bundle,
    { rejectDeprecatedRefs: false },
  )
  if (!compiled.ok) return { ok: false, code: 'schema_invalid', error: compiled.error }
  return { ok: true, version: record.version, mode: record.mode, validate: compiled.validate }
}

function findLatestEnforcedVersion(
  versions: SchemaVersionRecord[],
): SchemaVersionRecord | undefined {
  let latest: SchemaVersionRecord | undefined
  for (const record of versions) {
    if (record.mode === 'enforced' && (!latest || record.version > latest.version)) {
      latest = record
    }
  }
  return latest
}

export function resolveCachedLookup(
  cache: StoreValidatorCache,
  schemaId: string,
  schemaVersion: number | undefined,
): CachedLookup {
  const cacheKey = schemaVersion === undefined ? schemaId : formatSchemaRef(schemaId, schemaVersion)
  const hit = cache.lookups.get(cacheKey)
  if (hit) return hit

  const entry = cache.bundle.schemas.find((item) => item.id === schemaId)
  if (!entry) {
    return { ok: false, code: 'schema_not_found', error: `schema not found: ${schemaId}` }
  }
  if (entry.deprecatedAt !== null) {
    const targetVersion = schemaVersion ?? entry.latestVersion
    const hasVersion = entry.versions.some((v) => v.version === targetVersion)
    const outcome: CachedLookup = {
      ok: false,
      code: 'schema_deprecated',
      error: `schema is deprecated: ${schemaId}`,
      ...(hasVersion ? { deprecatedVersion: targetVersion } : {}),
    }
    // Cache only registered versions so arbitrary unknown versions on a deprecated schema cannot grow the map.
    if (hasVersion) cache.lookups.set(cacheKey, outcome)
    return outcome
  }
  const targetVersion = schemaVersion ?? entry.latestVersion
  const versionRecord = entry.versions.find((v) => v.version === targetVersion)
  if (!versionRecord) {
    return {
      ok: false,
      code: 'schema_not_found',
      error: `schema version not found: ${formatSchemaRef(schemaId, targetVersion)}`,
    }
  }
  const compiledTarget = compileVersionRecord(schemaId, versionRecord, cache.bundle)
  let outcome: CachedLookup = compiledTarget
  if (compiledTarget.ok && schemaVersion === undefined && versionRecord.mode === 'shadow') {
    const baselineRecord = findLatestEnforcedVersion(entry.versions)
    if (baselineRecord) {
      const compiledBaseline = compileVersionRecord(schemaId, baselineRecord, cache.bundle)
      outcome = compiledBaseline.ok
        ? {
            ...compiledTarget,
            enforcedBaseline: {
              version: compiledBaseline.version,
              mode: compiledBaseline.mode,
              validate: compiledBaseline.validate,
            },
          }
        : compiledBaseline
    }
  }
  cache.lookups.set(cacheKey, outcome)
  return outcome
}
