import { resolveClientCredential } from '../../auth/client.mjs'
import { validateEntryWrite, type SchemaEnforcementEnv } from '../../schemas/enforce.mjs'
import { SessionStoreError } from '../../store/errors.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import { readJsonBody } from '../body.mjs'
import { FORMAT_CONTENT_TYPE, formatEntries, resolveFormat } from '../format.mjs'
import { redactCredentials } from '../redact.mjs'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  payloadTooLargeResponse,
  streamResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { revisionHeaders } from './schemas-etag.mjs'
import { storeErrorResponse } from './store-error.mjs'

function objectData(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

async function appendEntry(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
  sessionId: string,
  env: SchemaEnforcementEnv,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok) {
    return parsed.tooLarge
      ? payloadTooLargeResponse()
      : errorResponse(400, 'body must be a JSON object')
  }
  const body = objectData(parsed.value)
  if (!body) return errorResponse(400, 'body must be a JSON object')
  const data = objectData(body.data)
  if (!data) return errorResponse(400, 'data must be an object')
  const { value: redactedData, redactedCount } = redactCredentials(data)
  const validation = await validateEntryWrite(store, body, redactedData, env)
  if (!validation.ok) return jsonResponse(validation.status, validation.body)
  try {
    const entry = await store.appendEntry({
      credId,
      sessionId,
      data: redactedData,
      ...(validation.schemaId !== undefined ? { schemaId: validation.schemaId } : {}),
      ...(validation.schemaVersion !== undefined
        ? { schemaVersion: validation.schemaVersion }
        : {}),
    })
    if (validation.shadowFailure) {
      try {
        await store.recordSchemaShadowFailure({ ...validation.shadowFailure, sessionId })
      } catch {
        // Best-effort telemetry: never fail an accepted entry write on shadow recording errors.
      }
    }
    const responseBody = {
      ...entry,
      ...(validation.warning ? { warning: validation.warning } : {}),
      ...(redactedCount > 0 ? { redactedCount } : {}),
    }
    return jsonResponse(
      201,
      responseBody,
      validation.revision !== undefined ? revisionHeaders(validation.revision) : undefined,
    )
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
}

async function getEntries(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
  sessionId: string,
): Promise<HandlerResponse> {
  const format = resolveFormat(request.query, request.headers)
  if (!format) return errorResponse(400, 'format must be one of json, jsonl, markdown')
  const session = await store.getSession(credId, sessionId)
  if (!session) {
    return storeErrorResponse(
      new SessionStoreError('session_not_found', `session not found: ${sessionId}`),
    )!
  }
  return streamResponse(
    200,
    FORMAT_CONTENT_TYPE[format],
    formatEntries(format, store.getEntries(credId, sessionId)),
  )
}

export async function handleEntriesRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  sessionId: string,
  env: SchemaEnforcementEnv = {},
): Promise<HandlerResponse> {
  const cred = await resolveClientCredential(request.headers.authorization, store)
  if (!cred) return unauthorizedResponse()
  if (request.method === 'POST') return appendEntry(request, store, cred.id, sessionId, env)
  if (request.method === 'GET') return getEntries(request, store, cred.id, sessionId)
  return notFoundResponse()
}
