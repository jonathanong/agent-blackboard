import type { ValidateFunction } from 'ajv/dist/2020.js'
import type { SchemaBundle, SchemaVersionMode } from '../core/types.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { compileRegisteredSchema } from './compile.mjs'
import { formatSchemaRef } from './id.mjs'

export type CachedLookup =
  | { ok: true; version: number; mode: SchemaVersionMode; validate: ValidateFunction }
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

export function resolveCachedLookup(
  cache: StoreValidatorCache,
  schemaId: string,
  schemaVersion: number | undefined,
): CachedLookup {
  const cacheKey = schemaVersion === undefined ? schemaId : formatSchemaRef(schemaId, schemaVersion)
  const hit = cache.lookups.get(cacheKey)
  if (hit) return hit

  const entry = cache.bundle.schemas.find((item) => item.id === schemaId)
  let outcome: CachedLookup
  if (!entry) {
    outcome = { ok: false, code: 'schema_not_found', error: `schema not found: ${schemaId}` }
  } else if (entry.deprecatedAt !== null) {
    const targetVersion = schemaVersion ?? entry.latestVersion
    const hasVersion = entry.versions.some((v) => v.version === targetVersion)
    outcome = {
      ok: false,
      code: 'schema_deprecated',
      error: `schema is deprecated: ${schemaId}`,
      ...(hasVersion ? { deprecatedVersion: targetVersion } : {}),
    }
  } else {
    const targetVersion = schemaVersion ?? entry.latestVersion
    const versionRecord = entry.versions.find((v) => v.version === targetVersion)
    if (!versionRecord) {
      outcome = {
        ok: false,
        code: 'schema_not_found',
        error: `schema version not found: ${formatSchemaRef(schemaId, targetVersion)}`,
      }
    } else {
      const compiled = compileRegisteredSchema(
        { id: schemaId, version: targetVersion, schema: versionRecord.schema },
        cache.bundle,
        { rejectDeprecatedRefs: false },
      )
      outcome = compiled.ok
        ? {
            ok: true,
            version: targetVersion,
            mode: versionRecord.mode,
            validate: compiled.validate,
          }
        : { ok: false, code: 'schema_invalid', error: compiled.error }
    }
  }
  // Do not cache missing-schema lookups so arbitrary nonexistent IDs/versions cannot grow the map unboundedly.
  if (outcome.ok || outcome.code !== 'schema_not_found') {
    cache.lookups.set(cacheKey, outcome)
  }
  return outcome
}
