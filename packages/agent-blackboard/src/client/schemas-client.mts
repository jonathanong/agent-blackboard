import { rawConditionalGet, requestJson } from './http.mjs'
import type {
  DeprecateSchemaResult,
  ListSchemasResult,
  PutSchemaResult,
  SchemaBundle,
  SchemaVersionDetail,
} from './schema-types.mjs'
import type { ClientConfig } from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

export async function listSchemasRequest(config: ClientConfig): Promise<ListSchemasResult> {
  return requestJson(config, '/schemas', { method: 'GET' })
}

export async function getSchemaRequest(
  config: ClientConfig,
  id: string,
  version?: number,
): Promise<SchemaVersionDetail> {
  const encodedId = encodeURIComponent(id)
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
  input: { schema: Record<string, unknown>; breaking?: boolean },
): Promise<PutSchemaResult> {
  return requestJson(config, `/schemas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  })
}

export async function deprecateSchemaRequest(
  config: ClientConfig,
  id: string,
): Promise<DeprecateSchemaResult> {
  return requestJson(config, `/schemas/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
