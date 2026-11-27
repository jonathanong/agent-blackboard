import { parseSchemaVersion } from '../../schemas/id.mjs'
import {
  DEFAULT_SHADOW_REPORT_LIMIT,
  MAX_SHADOW_REPORT_LIMIT,
  type BlackboardStore,
} from '../../store/store.mjs'
import { errorResponse, jsonResponse, notFoundResponse } from '../response.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { revisionHeaders } from './schemas-etag.mjs'
import { storeErrorResponse } from './store-error.mjs'

function parseReportLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_SHADOW_REPORT_LIMIT
  if (!/^[1-9][0-9]*$/.test(raw)) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed > MAX_SHADOW_REPORT_LIMIT) return undefined
  return parsed
}

export async function promoteSchemaRoute(
  store: BlackboardStore,
  adminName: string,
  id: string,
  versionRaw: string,
): Promise<HandlerResponse> {
  const version = parseSchemaVersion(versionRaw)
  if (version === undefined) return errorResponse(400, 'version must be a positive integer')
  try {
    const result = await store.promoteSchemaVersion(id, version, adminName)
    return jsonResponse(
      200,
      {
        ...result.versionRecord,
        revision: result.revision,
        alreadyEnforced: result.alreadyEnforced,
      },
      revisionHeaders(result.revision),
    )
  } catch (error) {
    const mapped = storeErrorResponse(error)
    if (mapped) return mapped
    throw error
  }
}

export async function getSchemaShadowReportRoute(
  request: HandlerRequest,
  store: BlackboardStore,
  id: string,
  versionRaw?: string,
): Promise<HandlerResponse> {
  let version: number | undefined
  if (versionRaw !== undefined) {
    version = parseSchemaVersion(versionRaw)
    if (version === undefined) return errorResponse(400, 'version must be a positive integer')
  }
  const limit = parseReportLimit(request.query.limit)
  if (limit === undefined) {
    return errorResponse(400, `limit must be an integer between 1 and ${MAX_SHADOW_REPORT_LIMIT}`)
  }
  const report = await store.getSchemaShadowReport(id, {
    ...(version !== undefined ? { version } : {}),
    limit,
  })
  if (!report) return notFoundResponse()
  return jsonResponse(200, report, revisionHeaders(report.revision))
}
