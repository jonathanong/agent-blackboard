import { resolveClientCredential } from '../../auth/client.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import { readJsonBody } from '../body.mjs'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  payloadTooLargeResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { storeErrorResponse } from './store-error.mjs'

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value)
}

function objectData(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function createSession(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok) {
    return parsed.tooLarge
      ? payloadTooLargeResponse()
      : errorResponse(400, 'body must be a JSON object')
  }
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return errorResponse(400, 'body must be a JSON object')
  }
  const body = parsed.value as Record<string, unknown>
  if (!isSessionId(body.id))
    return errorResponse(400, 'id must contain only letters, numbers, ., _, :, or -')
  if (body.parentSessionId !== null && !isSessionId(body.parentSessionId)) {
    return errorResponse(400, 'parentSessionId must be a non-empty string or null')
  }
  if (!nonEmptyString(body.agent)) return errorResponse(400, 'agent must be a non-empty string')
  if (!nonEmptyString(body.version)) return errorResponse(400, 'version must be a non-empty string')
  try {
    return jsonResponse(
      201,
      await store.createSession({
        credId,
        id: body.id,
        parentSessionId: body.parentSessionId,
        agent: body.agent,
        version: body.version,
      }),
    )
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
}

async function listSessions(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
): Promise<HandlerResponse> {
  const archived = request.query.archived ?? 'false'
  if (archived !== 'true' && archived !== 'false')
    return errorResponse(400, 'archived must be true or false')
  const sessions = []
  for await (const session of store.listSessions(credId)) {
    if ((session.archivedAt !== null) === (archived === 'true')) sessions.push(session)
  }
  return jsonResponse(200, sessions)
}

async function getSession(
  store: BlackboardStore,
  credId: string,
  sessionId: string,
): Promise<HandlerResponse> {
  const session = await store.getSession(credId, sessionId)
  return session ? jsonResponse(200, session) : notFoundResponse()
}

async function archiveSession(
  store: BlackboardStore,
  credId: string,
  sessionId: string,
): Promise<HandlerResponse> {
  try {
    return jsonResponse(200, await store.archiveSession(credId, sessionId))
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
}

async function patchSessionData(
  store: BlackboardStore,
  credId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Promise<HandlerResponse> {
  if (Object.keys(data).length === 0) return errorResponse(400, 'data must be a non-empty object')
  try {
    return jsonResponse(200, await store.patchSession(credId, { sessionId, data }))
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
}

async function patchSession(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
  sessionId: string,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok) {
    return parsed.tooLarge
      ? payloadTooLargeResponse()
      : errorResponse(400, 'body must be a JSON object')
  }
  const body = objectData(parsed.value)
  if (!body) return errorResponse(400, 'body must be a JSON object')
  if (body.archived === true && Object.keys(body).length === 1) {
    return archiveSession(store, credId, sessionId)
  }
  const data = objectData(body.data)
  if (data && Object.keys(body).length === 1)
    return patchSessionData(store, credId, sessionId, data)
  return errorResponse(400, 'body must contain exactly one of archived or data')
}

export async function handleSessionsRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  sessionId?: string,
): Promise<HandlerResponse> {
  const cred = await resolveClientCredential(request.headers.authorization, store)
  if (!cred) return unauthorizedResponse()
  if (sessionId === undefined) {
    if (request.method === 'POST') return createSession(request, store, cred.id)
    if (request.method === 'GET') return listSessions(request, store, cred.id)
  } else {
    if (request.method === 'GET') return getSession(store, cred.id, sessionId)
    if (request.method === 'PATCH') return patchSession(request, store, cred.id, sessionId)
  }
  return notFoundResponse()
}
