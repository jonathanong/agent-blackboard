import { resolveAdminCredential } from '../../auth/admin.mjs'
import type { AdminEnv } from '../../auth/admin.mjs'
import type { TelemetryStore } from '../../store/store.mjs'
import { readJsonBody } from '../body.mjs'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

async function createCredentialRoute(
  request: HandlerRequest,
  store: TelemetryStore,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok) return errorResponse(400, 'body must be JSON')
  const name =
    typeof parsed.value === 'object' && parsed.value !== null
      ? (parsed.value as Record<string, unknown>).name
      : undefined
  if (!isNonEmptyString(name)) return errorResponse(400, 'name is required')
  const { record, token } = await store.createCredential(name)
  return jsonResponse(201, { id: record.id, name: record.name, token, createdAt: record.createdAt })
}

async function listCredentialsRoute(store: TelemetryStore): Promise<HandlerResponse> {
  const records = await store.listCredentials()
  return jsonResponse(
    200,
    records.map((record) => ({ id: record.id, name: record.name, createdAt: record.createdAt })),
  )
}

async function deleteCredentialRoute(
  request: HandlerRequest,
  store: TelemetryStore,
): Promise<HandlerResponse> {
  const { id, name } = request.query
  if (!id && !name) return errorResponse(400, 'id or name query parameter is required')
  const deleted = await store.deleteCredential({
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
  })
  if (!deleted) return errorResponse(404, 'credential not found')
  return jsonResponse(200, { deleted: true })
}

/**
 * `/credentials*` — admin auth ONLY. A telemetry token is rejected outright
 * (admin resolution never touches the store either way) — see
 * `resolveAdminCredential`. Never returns token hashes or raw tokens except
 * the one-time `POST /credentials` response.
 */
export async function handleCredentialsRoute(
  request: HandlerRequest,
  store: TelemetryStore,
  env: AdminEnv,
): Promise<HandlerResponse> {
  const adminName = resolveAdminCredential(request.headers.authorization, env)
  if (!adminName) return unauthorizedResponse()
  switch (request.method) {
    case 'POST':
      return createCredentialRoute(request, store)
    case 'GET':
      return listCredentialsRoute(store)
    case 'DELETE':
      return deleteCredentialRoute(request, store)
    default:
      return notFoundResponse()
  }
}
