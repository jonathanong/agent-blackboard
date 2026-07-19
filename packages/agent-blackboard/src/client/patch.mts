import { requestJson } from './http.mjs'
import type { ClientConfig, PatchEntryInput, SessionEntry } from './types.mjs'

export async function patchEntry(
  config: ClientConfig,
  input: PatchEntryInput,
): Promise<SessionEntry> {
  return requestJson(config, `/sessions/${encodeURIComponent(input.sessionId)}/entries`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ createdAt: input.createdAt, data: input.data }),
  })
}
