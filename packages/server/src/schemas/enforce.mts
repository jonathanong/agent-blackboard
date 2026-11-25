import type { ValidateFunction } from 'ajv/dist/2020.js'
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
}

export type EntrySchemaValidationResult =
  | EntrySchemaValidationSuccess
  | EntrySchemaValidationFailure

interface CachedValidator {
  version: number
  validate: ValidateFunction
}

interface StoreValidatorCache {
  revision: number
  validators: Map<string, CachedValidator>
}

const validatorCaches = new WeakMap<BlackboardStore, StoreValidatorCache>()

function fail(
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
): EntrySchemaValidationFailure {
  return { ok: false, status: 400, body: { error, code, ...extra } }
}

function getCache(store: BlackboardStore, revision: number): Map<string, CachedValidator> {
  const existing = validatorCaches.get(store)
  if (existing && existing.revision === revision) return existing.validators
  const fresh: StoreValidatorCache = { revision, validators: new Map() }
  validatorCaches.set(store, fresh)
  return fresh.validators
}

/**
 * Enforces write-time JSON Schema validation for `POST /sessions/:id/entries`.
 * When `AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT` is `'required'`, `schemaId` is mandatory;
 * otherwise unschematized writes remain allowed while any supplied `schemaId` is strictly validated.
 */
export async function validateEntryWrite(
  store: BlackboardStore,
  body: Record<string, unknown>,
  data: Record<string, unknown>,
  env: SchemaEnforcementEnv,
): Promise<EntrySchemaValidationResult> {
  const { schemaId, schemaVersion } = body
  if (schemaVersion !== undefined && schemaId === undefined) {
    return fail('invalid_schema_ref', 'schemaVersion requires schemaId')
  }
  if (schemaId === undefined) {
    if (env.AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT === 'required') {
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
  const cache = getCache(store, revision)
  const cacheKey = schemaVersion === undefined ? schemaId : formatSchemaRef(schemaId, schemaVersion)

  let cached = cache.get(cacheKey)
  if (!cached) {
    const bundle = await store.getSchemaBundle()
    const entry = bundle.schemas.find((item) => item.id === schemaId)
    if (!entry) return fail('schema_not_found', `schema not found: ${schemaId}`)
    if (entry.deprecatedAt !== null) {
      return fail('schema_deprecated', `schema is deprecated: ${schemaId}`)
    }
    const targetVersion = schemaVersion ?? entry.latestVersion
    const versionRecord = entry.versions.find((v) => v.version === targetVersion)
    if (!versionRecord) {
      return fail(
        'schema_not_found',
        `schema version not found: ${formatSchemaRef(schemaId, targetVersion)}`,
      )
    }
    const compiled = compileRegisteredSchema(
      { id: schemaId, version: targetVersion, schema: versionRecord.schema },
      bundle,
      { rejectDeprecatedRefs: false },
    )
    if (!compiled.ok) return fail('schema_invalid', compiled.error)
    cached = { version: targetVersion, validate: compiled.validate }
    getCache(store, bundle.revision).set(cacheKey, cached)
  }

  if (!cached.validate(data)) {
    const ref = formatSchemaRef(schemaId, cached.version)
    return fail('schema_validation_failed', `entry data failed schema validation (${ref})`, {
      schema: ref,
      details: cached.validate.errors!.map((err) => ({
        instancePath: err.instancePath,
        schemaPath: err.schemaPath,
        keyword: err.keyword,
        message: String(err.message),
      })),
    })
  }

  return { ok: true, schemaId, schemaVersion: cached.version }
}
