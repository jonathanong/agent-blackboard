import { checkBackwardCompatibility } from '../../schemas/compatibility.mjs'
import { compileRegisteredSchema } from '../../schemas/compile.mjs'
import { isValidSchemaId } from '../../schemas/id.mjs'
import { validateSchemaDocument } from '../../schemas/refs.mjs'
import { SessionStoreError } from '../../store/errors.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import { readJsonBody } from '../body.mjs'
import { errorResponse, jsonResponse, payloadTooLargeResponse } from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { revisionHeaders } from './schemas-etag.mjs'
import { storeErrorResponse } from './store-error.mjs'

const MAX_PUT_ATTEMPTS = 3

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function putSchemaRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  adminName: string,
  id: string,
): Promise<HandlerResponse> {
  if (!isValidSchemaId(id)) {
    return errorResponse(
      400,
      'schema id must start with a letter or digit and contain only letters, numbers, ., _, or - (no "..")',
    )
  }
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok) {
    return parsed.tooLarge
      ? payloadTooLargeResponse()
      : errorResponse(400, 'body must be a JSON object')
  }
  if (!isPlainObject(parsed.value)) return errorResponse(400, 'body must be a JSON object')
  const { schema, breaking, shadow } = parsed.value
  if (breaking !== undefined && typeof breaking !== 'boolean') {
    return errorResponse(400, 'breaking must be a boolean')
  }
  if (shadow !== undefined && typeof shadow !== 'boolean') {
    return errorResponse(400, 'shadow must be a boolean')
  }
  const docCheck = validateSchemaDocument(schema)
  if (!docCheck.ok) return errorResponse(400, docCheck.error)
  const schemaObj = schema as Record<string, unknown>

  for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
    const bundle = await store.getSchemaBundle()
    const existing = bundle.schemas.find((item) => item.id === id)
    if (existing !== undefined && existing.deprecatedAt !== null) {
      return jsonResponse(409, { error: `schema is deprecated: ${id}`, code: 'schema_deprecated' })
    }
    const expectedVersion = existing?.latestVersion ?? 0
    const compiled = compileRegisteredSchema(
      { id, version: expectedVersion + 1, schema: schemaObj },
      bundle,
      { rejectDeprecatedRefs: true },
    )
    if (!compiled.ok) return errorResponse(400, compiled.error)

    const latestPrev = existing?.versions.find((v) => v.version === existing.latestVersion)
    const compat = latestPrev
      ? checkBackwardCompatibility(latestPrev.schema, schemaObj)
      : { compatible: true, breakingChanges: [] }
    if (!compat.compatible && breaking !== true) {
      return jsonResponse(409, {
        error: 'breaking schema change requires --breaking',
        code: 'breaking_change',
        compatible: false,
        breakingChanges: compat.breakingChanges,
      })
    }

    try {
      const result = await store.putSchemaVersion({
        id,
        schema: schemaObj,
        actor: adminName,
        expectedVersion,
        expectedRevision: bundle.revision,
        ...(shadow ? { mode: 'shadow' } : {}),
      })
      return jsonResponse(
        201,
        {
          ...result.versionRecord,
          revision: result.revision,
          compatible: compat.compatible,
          breakingChanges: compat.breakingChanges,
        },
        revisionHeaders(result.revision),
      )
    } catch (error) {
      if (
        error instanceof SessionStoreError &&
        error.code === 'schema_conflict' &&
        attempt + 1 < MAX_PUT_ATTEMPTS
      ) {
        continue
      }
      const mapped = storeErrorResponse(error)
      if (mapped) return mapped
      throw error
    }
  }
  /* v8 ignore next -- loop always returns or throws on the final attempt */
  return errorResponse(409, `schema ${id} was modified concurrently`)
}
