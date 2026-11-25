import { isValidSchemaId } from '../schemas/id.mjs'
import { rawConditionalGet, requestJson } from './http.mjs'
import type {
  DeprecateSchemaResult,
  ListSchemasResult,
  PromoteSchemaResult,
  PutSchemaResult,
  SchemaBundle,
  SchemaShadowReport,
  SchemaVersionDetail,
} from './schema-types.mjs'
import type { ClientConfig } from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

function requireValidSchemaId(id: string): string {
  if (!isValidSchemaId(id)) throw new TypeError(`Invalid schema id: ${id}`)
  return encodeURIComponent(id)
}

export async function listSchemasRequest(config: ClientConfig): Promise<ListSchemasResult> {
  return requestJson(config, '/schemas', { method: 'GET' })
}

export async function getSchemaRequest(
  config: ClientConfig,
  id: string,
  version?: number,
): Promise<SchemaVersionDetail> {
  const encodedId = requireValidSchemaId(id)
  const path =
    version === undefined ? `/schemas/${encodedId}` : `/schemas/${encodedId}/versions/${version}`
  return requestJson(config, path, { method: 'GET' })
}

export type FetchSchemaBundleResult =
  | { notModified: true; revision: number }
  | { notModified: false; bundle: SchemaBundle }

export async function fetchSchemaBundleRequest(
  config: ClientConfig,
  ifNoneMatchRevision?: number,
): Promise<FetchSchemaBundleResult> {
  const headers =
    ifNoneMatchRevision === undefined
      ? undefined
      : { 'if-none-match': `"rev-${ifNoneMatchRevision}"` }
  const response = await rawConditionalGet(config, '/schemas', {
    query: { include: 'versions' },
    ...(headers ? { headers } : {}),
  })
  if (response.status === 304) {
    const rawRev = response.headers.get('x-schema-registry-revision')
    const revision =
      rawRev !== null && /^[0-9]+$/.test(rawRev)
        ? Number.parseInt(rawRev, 10)
        : (ifNoneMatchRevision ?? 0)
    return { notModified: true, revision }
  }
  const bundle = (await response.json()) as SchemaBundle
  return { notModified: false, bundle }
}

export async function putSchemaRequest(
  config: ClientConfig,
  id: string,
  input: { schema: Record<string, unknown>; breaking?: boolean; shadow?: boolean },
): Promise<PutSchemaResult> {
  return requestJson(config, `/schemas/${requireValidSchemaId(id)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  })
}

export async function promoteSchemaRequest(
  config: ClientConfig,
  id: string,
  version: number,
): Promise<PromoteSchemaResult> {
  return requestJson(config, `/schemas/${requireValidSchemaId(id)}/versions/${version}/promote`, {
    method: 'POST',
  })
}

export async function getSchemaReportRequest(
  config: ClientConfig,
  id: string,
  version?: number,
  limit?: number,
): Promise<SchemaShadowReport> {
  const encodedId = requireValidSchemaId(id)
  const path =
    version === undefined
      ? `/schemas/${encodedId}/report`
      : `/schemas/${encodedId}/versions/${version}/report`
  return requestJson(config, path, {
    method: 'GET',
    ...(limit !== undefined ? { query: { limit: String(limit) } } : {}),
  })
}

export async function deprecateSchemaRequest(
  config: ClientConfig,
  id: string,
): Promise<DeprecateSchemaResult> {
  return requestJson(config, `/schemas/${requireValidSchemaId(id)}`, { method: 'DELETE' })
}
