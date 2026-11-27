import type { ValidateFunction } from 'ajv/dist/2020.js'
import type { SchemaShadowWarning, SchemaValidationIssue } from '../core/types.mjs'
import type { BlackboardStore, RecordSchemaShadowFailureInput } from '../store/store.mjs'
import { getSnapshotCache, resolveCachedLookup } from './enforce-cache.mjs'
import { formatSchemaRef, isValidSchemaId } from './id.mjs'

export interface SchemaEnforcementEnv {
  AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT?: string
}

export type SchemaEnforcementMode = 'optional' | 'shadow' | 'required'

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
  warning?: SchemaShadowWarning
  shadowFailure?: Omit<RecordSchemaShadowFailureInput, 'sessionId'>
}

export type EntrySchemaValidationResult =
  | EntrySchemaValidationSuccess
  | EntrySchemaValidationFailure

function fail(
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
): EntrySchemaValidationFailure {
  return { ok: false, status: 400, body: { error, code, ...extra } }
}

/** Validates and resolves `AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT`, throwing loudly on unknown values. */
export function resolveEnforcementMode(env: SchemaEnforcementEnv): SchemaEnforcementMode {
  const mode = env.AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT
  if (mode === undefined || mode === 'optional') return 'optional'
  if (mode === 'shadow' || mode === 'required') return mode
  throw new Error(
    `Invalid AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT value: ${mode} (expected "optional", "shadow", or "required")`,
  )
}

function rejectOrWarn(
  mode: SchemaEnforcementMode,
  code: string,
  message: string,
): EntrySchemaValidationResult {
  return mode === 'shadow' ? { ok: true, warning: { code, message } } : fail(code, message)
}

function validationDetails(validate: ValidateFunction): SchemaValidationIssue[] {
  return validate.errors!.map(({ instancePath, schemaPath, keyword, message }) => ({
    instancePath,
    schemaPath,
    keyword,
    message: String(message),
  }))
}

function shadowOutcome(
  schemaId: string,
  failedVersion: number,
  validate: ValidateFunction,
  revision: number,
  validatedVersion?: number,
): EntrySchemaValidationSuccess {
  const ref = formatSchemaRef(schemaId, failedVersion)
  const message = `entry data failed schema validation (${ref})`
  const details = validationDetails(validate)
  const code = 'schema_validation_failed'
  return {
    ok: true,
    ...(validatedVersion !== undefined ? { schemaId, schemaVersion: validatedVersion } : {}),
    revision,
    warning: { code, message, schema: ref, details },
    shadowFailure: { schemaId, schemaVersion: failedVersion, code, message, details },
  }
}

function rejectOrShadow(
  warnOnly: boolean,
  schemaId: string,
  version: number,
  validate: ValidateFunction,
  revision: number,
): EntrySchemaValidationResult {
  if (warnOnly) return shadowOutcome(schemaId, version, validate, revision)
  const ref = formatSchemaRef(schemaId, version)
  return fail('schema_validation_failed', `entry data failed schema validation (${ref})`, {
    schema: ref,
    details: validationDetails(validate),
  })
}

/**
 * Enforces write-time JSON Schema validation for `POST /sessions/:id/entries` across `optional`,
 * `shadow`, and `required` modes while preserving prior enforced baselines on shadow upgrades.
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
    return rejectOrWarn(mode, 'invalid_schema_ref', 'schemaVersion requires schemaId')
  }
  if (schemaId === undefined) {
    if (mode === 'required') {
      return fail('schema_required', 'schemaId is required by server schema enforcement policy')
    }
    return { ok: true }
  }
  if (!isValidSchemaId(schemaId)) {
    return rejectOrWarn(mode, 'invalid_schema_ref', 'invalid schemaId')
  }
  if (
    schemaVersion !== undefined &&
    (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
  ) {
    return rejectOrWarn(mode, 'invalid_schema_ref', 'schemaVersion must be a positive integer')
  }

  const revision = await store.getSchemaRegistryRevision()
  const cache = await getSnapshotCache(store, revision)
  const lookup = resolveCachedLookup(cache, schemaId, schemaVersion)
  if (!lookup.ok) {
    if (mode !== 'shadow') return fail(lookup.code, lookup.error)
    const shadowFailure =
      lookup.deprecatedVersion !== undefined
        ? {
            schemaId,
            schemaVersion: lookup.deprecatedVersion,
            code: lookup.code,
            message: lookup.error,
            details: [],
          }
        : undefined
    return {
      ok: true,
      revision: cache.revision,
      warning: { code: lookup.code, message: lookup.error },
      ...(shadowFailure ? { shadowFailure } : {}),
    }
  }

  if (lookup.enforcedBaseline) {
    const baseline = lookup.enforcedBaseline
    if (!baseline.validate(data)) {
      return rejectOrShadow(
        mode === 'shadow',
        schemaId,
        baseline.version,
        baseline.validate,
        cache.revision,
      )
    }
    if (!lookup.validate(data)) {
      return shadowOutcome(
        schemaId,
        lookup.version,
        lookup.validate,
        cache.revision,
        baseline.version,
      )
    }
    return { ok: true, schemaId, schemaVersion: lookup.version, revision: cache.revision }
  }

  if (!lookup.validate(data)) {
    return rejectOrShadow(
      mode === 'shadow' || lookup.mode === 'shadow',
      schemaId,
      lookup.version,
      lookup.validate,
      cache.revision,
    )
  }

  return { ok: true, schemaId, schemaVersion: lookup.version, revision: cache.revision }
}
