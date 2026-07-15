import { readJsonBody } from '../body.mjs'
import { errorResponse, jsonResponse } from '../response.mjs'
import type { CredentialRecord, HandlerRequest, HandlerResponse } from '../types.mjs'
import type { EntryPatch, JournalStore } from '../../store/store.mjs'

function isValidPatch(value: unknown): value is EntryPatch {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (candidate.archived !== undefined && typeof candidate.archived !== 'boolean') return false
  if (candidate.data !== undefined) {
    if (
      typeof candidate.data !== 'object' ||
      candidate.data === null ||
      Array.isArray(candidate.data)
    )
      return false
    if (Object.keys(candidate.data).length === 0 && candidate.archived === undefined) return false
  }
  return candidate.archived !== undefined || candidate.data !== undefined
}

/** Body: a non-empty JSON array of `{ id, archived?, data? }`. `data` is merged (not replaced) by the store. */
export async function patchJournals(
  request: HandlerRequest,
  store: JournalStore,
  cred: CredentialRecord,
): Promise<HandlerResponse> {
  const parsed = await readJsonBody(request.body)
  if (!parsed.ok) return errorResponse(400, 'body must be JSON')
  if (!Array.isArray(parsed.value) || parsed.value.length === 0) {
    return errorResponse(400, 'body must be a non-empty JSON array of patches')
  }
  const patches: EntryPatch[] = []
  for (const item of parsed.value) {
    if (!isValidPatch(item)) {
      return errorResponse(
        400,
        'each patch requires an id and at least one of archived or a non-empty data object',
      )
    }
    patches.push(item)
  }
  const updated = await store.patchEntries(cred.id, patches)
  return jsonResponse(200, updated)
}
