import { FORMAT_CONTENT_TYPE, formatEntries, resolveFormat } from '../format.mjs'
import { errorResponse, streamResponse } from '../response.mjs'
import type { CredentialRecord, HandlerRequest, HandlerResponse } from '../types.mjs'
import type { EntryFilter, TelemetryStore } from '../../store/store.mjs'

function resolveArchivedFilter(
  archivedParam: string | undefined,
): { ok: true; archived?: boolean } | { ok: false } {
  if (archivedParam === undefined) return { ok: true }
  if (archivedParam === 'true') return { ok: true, archived: true }
  if (archivedParam === 'false') return { ok: true, archived: false }
  return { ok: false }
}

/** Streams entries from the store, formatted per `?format=`/`Accept` — see `format.mts`. */
export async function getTelemetry(
  request: HandlerRequest,
  store: TelemetryStore,
  cred: CredentialRecord,
): Promise<HandlerResponse> {
  const format = resolveFormat(request.query, request.headers)
  if (!format) return errorResponse(400, 'format must be one of json, jsonl, markdown')
  const archivedResult = resolveArchivedFilter(request.query.archived)
  if (!archivedResult.ok) return errorResponse(400, 'archived must be "true" or "false"')
  const filter: EntryFilter = {
    ...(request.query.sessionId !== undefined ? { sessionId: request.query.sessionId } : {}),
    ...(request.query.agent !== undefined ? { agent: request.query.agent } : {}),
    ...(archivedResult.archived !== undefined ? { archived: archivedResult.archived } : {}),
  }
  const entries = store.getEntries(cred.id, filter)
  return streamResponse(200, FORMAT_CONTENT_TYPE[format], formatEntries(format, entries))
}
