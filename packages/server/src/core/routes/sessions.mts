import { resolveClientCredential } from '../../auth/client.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import { readJsonBody } from '../body.mjs'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { storeErrorResponse } from './store-error.mjs'

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value)
}

async function createSession(
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (
    !parsed.ok ||
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return errorResponse(400, 'body must be a JSON object')
  }
  const body = parsed.value as Record<string, unknown>
  if (!isSessionId(body.id))
    return errorResponse(400, 'id must contain only letters, numbers, ., _, :, or -')
  if (body.parentSessionId !== null && !isSessionId(body.parentSessionId)) {
    return errorResponse(400, 'parentSessionId must be a non-empty string or null')
  }
  try {
    return jsonResponse(
      201,
      await store.createSession({ credId, id: body.id, parentSessionId: body.parentSessionId }),
    )
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
}

async function listSessions(store: BlackboardStore, credId: string): Promise<HandlerResponse> {
  const sessions = []
  for await (const session of store.listSessions(credId)) sessions.push(session)
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
  request: HandlerRequest,
  store: BlackboardStore,
  credId: string,
  sessionId: string,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (
    !parsed.ok ||
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return errorResponse(400, 'body must be {"archived":true}')
  }
  if ((parsed.value as Record<string, unknown>).archived !== true) {
    return errorResponse(400, 'archived must be true')
  }
  try {
    return jsonResponse(200, await store.archiveSession(credId, sessionId))
  } catch (error) {
    const response = storeErrorResponse(error)
    if (response) return response
    throw error
  }
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
    if (request.method === 'GET') return listSessions(store, cred.id)
  } else {
    if (request.method === 'GET') return getSession(store, cred.id, sessionId)
    if (request.method === 'PATCH') return archiveSession(request, store, cred.id, sessionId)
  }
  return notFoundResponse()
}
