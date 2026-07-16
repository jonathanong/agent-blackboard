import { parseTelemetryEntriesBody } from '../parse-telemetry-input.mjs'
import { errorResponse, jsonResponse } from '../response.mjs'
import type { CredentialRecord, HandlerRequest, HandlerResponse } from '../types.mjs'
import type { TelemetryStore } from '../../store/store.mjs'
import { MAX_APPEND_BATCH_SIZE } from '../../store/store.mjs'

/**
 * Appends every entry in the body (single object / array / NDJSON) as one
 * atomic batch and returns the created entries as a JSON array. Rejecting an
 * oversized batch here (before it reaches the store) keeps the size check
 * visible to callers as a normal 400, rather than a store-internal failure.
 */
export async function postTelemetry(
  request: HandlerRequest,
  store: TelemetryStore,
  cred: CredentialRecord,
): Promise<HandlerResponse> {
  const parsed = await parseTelemetryEntriesBody(request.body)
  if (!parsed.ok) return errorResponse(400, parsed.error)
  if (parsed.entries.length > MAX_APPEND_BATCH_SIZE) {
    return errorResponse(
      400,
      `batch of ${parsed.entries.length} entries exceeds the ${MAX_APPEND_BATCH_SIZE}-entry limit`,
    )
  }
  const created = await store.appendEntries(
    parsed.entries.map((input) => ({
      credId: cred.id,
      sessionId: input.sessionId,
      agent: input.agent,
      data: input.data,
    })),
  )
  return jsonResponse(201, created)
}
