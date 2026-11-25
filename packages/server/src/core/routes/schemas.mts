import { resolveAdminCredential } from '../../auth/admin.mjs'
import type { AdminEnv } from '../../auth/admin.mjs'
import { resolveClientCredential } from '../../auth/client.mjs'
import { parseSchemaVersion } from '../../schemas/id.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  notModifiedResponse,
  unauthorizedResponse,
} from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { etagMatches, revisionHeaders, schemaRegistryEtag } from './schemas-etag.mjs'
import { putSchemaRoute } from './schemas-put.mjs'
import { storeErrorResponse } from './store-error.mjs'

export interface SchemaRouteTarget {
  id?: string
  versionsList?: boolean
  versionRaw?: string
}

async function authorizeRead(
  request: HandlerRequest,
  store: BlackboardStore,
  env: AdminEnv,
): Promise<boolean> {
  if (resolveAdminCredential(request.headers.authorization, env)) return true
  return (await resolveClientCredential(request.headers.authorization, store)) !== undefined
}

async function listOrBundleSchemas(
  request: HandlerRequest,
  store: BlackboardStore,
): Promise<HandlerResponse> {
  const include = request.query.include
  if (include !== undefined && include !== 'versions') {
    return errorResponse(400, 'include must be "versions" when provided')
  }
  const currentRevision = await store.getSchemaRegistryRevision()
  const currentEtag = schemaRegistryEtag(currentRevision)
  if (etagMatches(request.headers['if-none-match'], currentEtag)) {
    return notModifiedResponse(revisionHeaders(currentRevision, { etag: currentEtag }))
  }
  if (include === 'versions') {
    const bundle = await store.getSchemaBundle()
    const etag = schemaRegistryEtag(bundle.revision)
    return jsonResponse(200, bundle, revisionHeaders(bundle.revision, { etag }))
  }
  const list = await store.listSchemas()
  const etag = schemaRegistryEtag(list.revision)
  return jsonResponse(200, list, revisionHeaders(list.revision, { etag }))
}

async function getOneSchema(
  store: BlackboardStore,
  id: string,
  versionRaw?: string,
): Promise<HandlerResponse> {
  let version: number | undefined
  if (versionRaw !== undefined) {
    version = parseSchemaVersion(versionRaw)
    if (version === undefined) return errorResponse(400, 'version must be a positive integer')
  }
  const found = await store.getSchema(id, version)
  if (!found) return notFoundResponse()
  return jsonResponse(
    200,
    {
      ...found.summary,
      version: found.versionRecord.version,
      ref: found.versionRecord.ref,
      schema: found.versionRecord.schema,
      versionCreatedAt: found.versionRecord.createdAt,
      versionCreatedBy: found.versionRecord.createdBy,
      revision: found.revision,
    },
    revisionHeaders(found.revision),
  )
}

async function listVersions(store: BlackboardStore, id: string): Promise<HandlerResponse> {
  const found = await store.listSchemaVersions(id)
  if (!found) return notFoundResponse()
  return jsonResponse(
    200,
    { ...found.summary, versions: found.versions, revision: found.revision },
    revisionHeaders(found.revision),
  )
}

async function deprecateSchema(
  store: BlackboardStore,
  adminName: string,
  id: string,
): Promise<HandlerResponse> {
  try {
    const result = await store.deprecateSchema(id, adminName)
    return jsonResponse(
      200,
      {
        id: result.summary.id,
        latestVersion: result.summary.latestVersion,
        deprecatedAt: result.summary.deprecatedAt,
        deprecatedBy: result.summary.deprecatedBy,
        revision: result.revision,
      },
      revisionHeaders(result.revision),
    )
  } catch (error) {
    const mapped = storeErrorResponse(error)
    if (mapped) return mapped
    throw error
  }
}

export async function handleSchemasRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  env: AdminEnv,
  target: SchemaRouteTarget = {},
): Promise<HandlerResponse> {
  if (request.method === 'GET') {
    if (!(await authorizeRead(request, store, env))) return unauthorizedResponse()
    if (target.id === undefined) return listOrBundleSchemas(request, store)
    if (target.versionsList) return listVersions(store, target.id)
    return getOneSchema(store, target.id, target.versionRaw)
  }
  if (target.id !== undefined && !target.versionsList && target.versionRaw === undefined) {
    const adminName = resolveAdminCredential(request.headers.authorization, env)
    if (!adminName) return unauthorizedResponse()
    if (request.method === 'PUT') return putSchemaRoute(request, store, adminName, target.id)
    if (request.method === 'DELETE') return deprecateSchema(store, adminName, target.id)
  }
  return notFoundResponse()
}
