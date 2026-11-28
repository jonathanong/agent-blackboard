/**
 * Framework-agnostic HTTP core for agent-blackboard. `handleRequest` is the one
 * entrypoint every adapter (Lambda `streamifyResponse` handler, `node:http`
 * `local-server.mts`) calls — it contains all routing/auth/business logic
 * and has zero knowledge of Lambda or Node's HTTP module.
 *
 * ROUTING: unknown paths -> 404. A method not implemented on a known path
 * is also 404 (not 405). Missing or invalid auth -> 401. Every authenticated
 * response carries `x-schema-registry-revision` so clients notice schema drift.
 */
import type { AdminEnv } from '../auth/admin.mjs'
import type { SchemaEnforcementEnv } from '../schemas/enforce.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { notFoundResponse } from './response.mjs'
import { handleCredentialsRoute } from './routes/credentials.mjs'
import { handleEntriesRoute } from './routes/entries.mjs'
import { handleHealthRoute } from './routes/health.mjs'
import { SCHEMA_REVISION_HEADER } from './routes/schemas-etag.mjs'
import { handleSchemasRoute } from './routes/schemas.mjs'
import { handleSessionsRoute } from './routes/sessions.mjs'
import { handleSnapshotRoute } from './routes/snapshot.mjs'
import type { HandlerRequest, HandlerResponse } from './types.mjs'

export type ServerEnv = AdminEnv & SchemaEnforcementEnv

export interface HandleRequestDeps {
  store: BlackboardStore
  now: () => Date
  env: ServerEnv
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

async function routeMatched(
  path: string,
  request: HandlerRequest,
  deps: HandleRequestDeps,
): Promise<HandlerResponse | undefined> {
  if (path === '/health') return handleHealthRoute(request, deps.store, deps.env)
  if (path === '/credentials') return handleCredentialsRoute(request, deps.store, deps.env)
  if (path === '/snapshot') return handleSnapshotRoute(request, deps.store, deps.now)
  if (path === '/sessions') return handleSessionsRoute(request, deps.store)
  if (path === '/schemas') return handleSchemasRoute(request, deps.store, deps.env)

  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(path)
  if (sessionMatch) {
    const sessionId = decodeSegment(sessionMatch[1]!)
    return sessionId === null ? undefined : handleSessionsRoute(request, deps.store, sessionId)
  }
  const entriesMatch = /^\/sessions\/([^/]+)\/entries$/.exec(path)
  if (entriesMatch) {
    const sessionId = decodeSegment(entriesMatch[1]!)
    return sessionId === null
      ? undefined
      : handleEntriesRoute(request, deps.store, sessionId, deps.env)
  }
  const schemaMatch = /^\/schemas\/([^/]+)$/.exec(path)
  if (schemaMatch) {
    const id = decodeSegment(schemaMatch[1]!)
    return id === null ? undefined : handleSchemasRoute(request, deps.store, deps.env, { id })
  }
  const schemaReportMatch = /^\/schemas\/([^/]+)\/report$/.exec(path)
  if (schemaReportMatch) {
    const id = decodeSegment(schemaReportMatch[1]!)
    return id === null
      ? undefined
      : handleSchemasRoute(request, deps.store, deps.env, { id, report: true })
  }
  const schemaVersionsMatch = /^\/schemas\/([^/]+)\/versions$/.exec(path)
  if (schemaVersionsMatch) {
    const id = decodeSegment(schemaVersionsMatch[1]!)
    return id === null
      ? undefined
      : handleSchemasRoute(request, deps.store, deps.env, { id, versionsList: true })
  }
  const schemaVersionMatch = /^\/schemas\/([^/]+)\/versions\/([^/]+)$/.exec(path)
  if (schemaVersionMatch) {
    const id = decodeSegment(schemaVersionMatch[1]!)
    const versionRaw = decodeSegment(schemaVersionMatch[2]!)
    return id === null || versionRaw === null
      ? undefined
      : handleSchemasRoute(request, deps.store, deps.env, { id, versionRaw })
  }
  const schemaPromoteMatch = /^\/schemas\/([^/]+)\/versions\/([^/]+)\/promote$/.exec(path)
  if (schemaPromoteMatch) {
    const id = decodeSegment(schemaPromoteMatch[1]!)
    const versionRaw = decodeSegment(schemaPromoteMatch[2]!)
    return id === null || versionRaw === null
      ? undefined
      : handleSchemasRoute(request, deps.store, deps.env, { id, versionRaw, promote: true })
  }
  const schemaVersionReportMatch = /^\/schemas\/([^/]+)\/versions\/([^/]+)\/report$/.exec(path)
  if (schemaVersionReportMatch) {
    const id = decodeSegment(schemaVersionReportMatch[1]!)
    const versionRaw = decodeSegment(schemaVersionReportMatch[2]!)
    return id === null || versionRaw === null
      ? undefined
      : handleSchemasRoute(request, deps.store, deps.env, { id, versionRaw, report: true })
  }
  return undefined
}

export async function handleRequest(
  request: HandlerRequest,
  deps: HandleRequestDeps,
): Promise<HandlerResponse> {
  const path = normalizePath(request.path)
  const response = await routeMatched(path, request, deps)
  if (!response) return notFoundResponse()
  if (
    path !== '/health' &&
    response.status !== 401 &&
    response.headers[SCHEMA_REVISION_HEADER] === undefined
  ) {
    try {
      const revision = await deps.store.getSchemaRegistryRevision()
      return {
        ...response,
        headers: { ...response.headers, [SCHEMA_REVISION_HEADER]: String(revision) },
      }
    } catch {
      return response
    }
  }
  return response
}
