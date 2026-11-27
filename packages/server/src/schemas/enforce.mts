import type { SchemaShadowWarning, SchemaValidationIssue } from '../core/types.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { getSnapshotCache, resolveCachedLookup } from './enforce-cache.mjs'
import { formatSchemaRef, isValidSchemaId } from './id.mjs'

export interface SchemaEnforcementEnv {
  AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT?: string
}

type SchemaEnforcementMode = 'optional' | 'shadow' | 'required'

interface EntrySchemaValidationFailure {
  ok: false
  status: number
  body: Record<string, unknown>
}

interface PendingShadowFailure {
  schemaId: string
  schemaVersion: number
  code: string
  message: string
  details: SchemaValidationIssue[]
}

interface EntrySchemaValidationSuccess {
  ok: true
  schemaId?: string
  schemaVersion?: number
  revision?: number
  warning?: SchemaShadowWarning
  shadowFailure?: PendingShadowFailure
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

function resolveEnforcementMode(env: SchemaEnforcementEnv): SchemaEnforcementMode {
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
  if (mode === 'shadow') return { ok: true, warning: { code, message } }
  return fail(code, message)
}

/**
 * Enforces write-time JSON Schema validation for `POST /sessions/:id/entries`.
 * Modes: `optional` (default — validate when `schemaId` is given), `required` (`schemaId`
 * mandatory), and `shadow` (validate every entry naming a schema, never reject). Per-version
 * shadow mode (`mode: 'shadow'`) also accepts validation failures with a warning and shadow log.
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

  if (!lookup.validate(data)) {
    const ref = formatSchemaRef(schemaId, lookup.version)
    const message = `entry data failed schema validation (${ref})`
    const details: SchemaValidationIssue[] = lookup.validate.errors!.map((err) => ({
      instancePath: err.instancePath,
      schemaPath: err.schemaPath,
      keyword: err.keyword,
      message: String(err.message),
    }))
    if (mode === 'shadow' || lookup.mode === 'shadow') {
      return {
        ok: true,
        schemaId,
        schemaVersion: lookup.version,
        revision: cache.revision,
        warning: { code: 'schema_validation_failed', message, schema: ref, details },
        shadowFailure: {
          schemaId,
          schemaVersion: lookup.version,
          code: 'schema_validation_failed',
          message,
          details,
        },
      }
    }
    return fail('schema_validation_failed', message, { schema: ref, details })
  }

  return { ok: true, schemaId, schemaVersion: lookup.version, revision: cache.revision }
}
