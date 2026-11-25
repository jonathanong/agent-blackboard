import type { ValidateFunction } from 'ajv/dist/2020.js'
import type { SchemaBundle } from '../core/types.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { compileRegisteredSchema } from './compile.mjs'
import { formatSchemaRef, isValidSchemaId } from './id.mjs'

export interface SchemaEnforcementEnv {
  AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT?: string
}

interface EntrySchemaValidationFailure {
  ok: false
  status: number
  body: Record<string, unknown>
}

interface EntrySchemaValidationSuccess {
  ok: true
  schemaId?: string
  schemaVersion?: number
  revision?: number
}

export type EntrySchemaValidationResult =
  | EntrySchemaValidationSuccess
  | EntrySchemaValidationFailure

type CachedLookup =
  | { ok: true; version: number; validate: ValidateFunction }
  | EntrySchemaValidationFailure

interface StoreValidatorCache {
  revision: number
  bundle: SchemaBundle
  lookups: Map<string, CachedLookup>
}

const validatorCaches = new WeakMap<BlackboardStore, StoreValidatorCache>()

function fail(
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
): EntrySchemaValidationFailure {
  return { ok: false, status: 400, body: { error, code, ...extra } }
}

function resolveEnforcementMode(env: SchemaEnforcementEnv): 'optional' | 'required' {
  const mode = env.AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT
  if (mode === undefined || mode === 'optional') return 'optional'
  if (mode === 'required') return 'required'
  throw new Error(
    `Invalid AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT value: ${mode} (expected "optional" or "required")`,
  )
}

async function getSnapshotCache(
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

function resolveCachedLookup(
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
    outcome = fail('schema_not_found', `schema not found: ${schemaId}`)
  } else if (entry.deprecatedAt !== null) {
    outcome = fail('schema_deprecated', `schema is deprecated: ${schemaId}`)
  } else {
    const targetVersion = schemaVersion ?? entry.latestVersion
    const versionRecord = entry.versions.find((v) => v.version === targetVersion)
    if (!versionRecord) {
      outcome = fail(
        'schema_not_found',
        `schema version not found: ${formatSchemaRef(schemaId, targetVersion)}`,
      )
    } else {
      const compiled = compileRegisteredSchema(
        { id: schemaId, version: targetVersion, schema: versionRecord.schema },
        cache.bundle,
        { rejectDeprecatedRefs: false },
      )
      outcome = compiled.ok
        ? { ok: true, version: targetVersion, validate: compiled.validate }
        : fail('schema_invalid', compiled.error)
    }
  }
  cache.lookups.set(cacheKey, outcome)
  return outcome
}

/**
 * Enforces write-time JSON Schema validation for `POST /sessions/:id/entries`.
 * When `AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT` is `'required'`, `schemaId` is mandatory;
 * when `'optional'` (default), unschematized writes remain allowed while any supplied
 * `schemaId` is strictly validated. Unrecognized env values throw loudly instead of failing open.
 */
export async function validateEntryWrite(
  store: BlackboardStore,
  body: Record<string, unknown>,
  data: Record<string, unknown>,
  env: SchemaEnforcementEnv,
): Promise<EntrySchemaValidationResult> {
  const mode = resolveEnforcementMode(env)
  const { schemaId, schemaVersion } = body
  if (schemaVersion !== undefined && schemaId === undefined) {
    return fail('invalid_schema_ref', 'schemaVersion requires schemaId')
  }
  if (schemaId === undefined) {
    if (mode === 'required') {
      return fail('schema_required', 'schemaId is required by server schema enforcement policy')
    }
    return { ok: true }
  }
  if (!isValidSchemaId(schemaId)) {
    return fail('invalid_schema_ref', 'invalid schemaId')
  }
  if (
    schemaVersion !== undefined &&
    (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
  ) {
    return fail('invalid_schema_ref', 'schemaVersion must be a positive integer')
  }

  const revision = await store.getSchemaRegistryRevision()
  const cache = await getSnapshotCache(store, revision)
  const lookup = resolveCachedLookup(cache, schemaId, schemaVersion)
  if (!lookup.ok) return lookup

  if (!lookup.validate(data)) {
    const ref = formatSchemaRef(schemaId, lookup.version)
    return fail('schema_validation_failed', `entry data failed schema validation (${ref})`, {
      schema: ref,
      details: lookup.validate.errors!.map((err) => ({
        instancePath: err.instancePath,
        schemaPath: err.schemaPath,
        keyword: err.keyword,
        message: String(err.message),
      })),
    })
  }

  return { ok: true, schemaId, schemaVersion: lookup.version, revision: cache.revision }
}
