import { requestJson } from './http.mjs'
import type { AppendEntryInput, AppendEntryResult, ClientConfig } from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

export async function appendEntry(
  config: ClientConfig,
  input: AppendEntryInput,
): Promise<AppendEntryResult> {
  return requestJson(config, `/sessions/${encodeURIComponent(input.sessionId)}/entries`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      data: input.data,
      ...(input.schemaId !== undefined ? { schemaId: input.schemaId } : {}),
      ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
      ...(input.sourceEventId !== undefined ? { sourceEventId: input.sourceEventId } : {}),
    }),
  })
}
