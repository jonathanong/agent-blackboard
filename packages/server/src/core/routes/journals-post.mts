import { parseJournalEntriesBody } from '../parse-journal-input.mjs'
import { errorResponse, jsonResponse } from '../response.mjs'
import type { CredentialRecord, HandlerRequest, HandlerResponse } from '../types.mjs'
import type { JournalStore } from '../../store/store.mjs'

/** Appends every entry in the body (single object / array / NDJSON) and returns the created entries, all at once, as a JSON array. */
export async function postJournals(
  request: HandlerRequest,
  store: JournalStore,
  cred: CredentialRecord,
): Promise<HandlerResponse> {
  const parsed = await parseJournalEntriesBody(request.body)
  if (!parsed.ok) return errorResponse(400, parsed.error)
  const created = []
  for (const input of parsed.entries) {
    created.push(
      await store.appendEntry({
        credId: cred.id,
        sessionId: input.sessionId,
        agent: input.agent,
        data: input.data,
      }),
    )
  }
  return jsonResponse(201, created)
}
