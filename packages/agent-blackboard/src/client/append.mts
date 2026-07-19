import { requestJson } from './http.mjs'
import type { AppendEntryInput, ClientConfig, SessionEntry } from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

export async function appendEntry(
  config: ClientConfig,
  input: AppendEntryInput,
): Promise<SessionEntry> {
  return requestJson(config, `/sessions/${encodeURIComponent(input.sessionId)}/entries`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ data: input.data }),
  })
}
