import { resolveClientCredential } from '../../auth/client.mjs'
import { SessionStoreError } from '../../store/errors.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import { readJsonBody } from '../body.mjs'
import { FORMAT_CONTENT_TYPE, formatEntries, resolveFormat } from '../format.mjs'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  streamResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
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
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok || !objectData(parsed.value))
    return errorResponse(400, 'body must be a JSON object')
  const data = objectData((parsed.value as Record<string, unknown>).data)
  if (!data) return errorResponse(400, 'data must be an object')
  try {
    return jsonResponse(201, await store.appendEntry({ credId, sessionId, data }))
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
  if (session.archivedAt !== null) {
    return storeErrorResponse(
      new SessionStoreError('session_archived', `session is archived: ${sessionId}`),
    )!
  }
  return streamResponse(
    200,
    FORMAT_CONTENT_TYPE[format],
    formatEntries(format, store.getEntries(credId, sessionId)),
  )
}

async function patchEntry(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
  sessionId: string,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  const body = objectData(parsed.ok ? parsed.value : undefined)
  if (!body) return errorResponse(400, 'body must be a JSON object')
  if (typeof body.createdAt !== 'string' || Number.isNaN(Date.parse(body.createdAt))) {
    return errorResponse(400, 'createdAt must be an ISO timestamp')
  }
  const data = objectData(body.data)
  if (!data || Object.keys(data).length === 0)
    return errorResponse(400, 'data must be a non-empty object')
  try {
    return jsonResponse(
      200,
      await store.patchEntry(credId, { sessionId, createdAt: body.createdAt, data }),
    )
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function handleEntriesRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  sessionId: string,
): Promise<HandlerResponse> {
  const cred = await resolveClientCredential(request.headers.authorization, store)
  if (!cred) return unauthorizedResponse()
  if (request.method === 'POST') return appendEntry(request, store, cred.id, sessionId)
  if (request.method === 'GET') return getEntries(request, store, cred.id, sessionId)
  if (request.method === 'PATCH') return patchEntry(request, store, cred.id, sessionId)
  return notFoundResponse()
}
