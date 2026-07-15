import { requestJson } from './http.mjs'
import type { ClientConfig, JournalEntry, PatchOp } from './types.mjs'

/**
 * Batch-patches journal entries. `data` is a shallow merge into each
 * entry's existing `data` blob, not a replace.
 */
export async function patchEntries(
  config: ClientConfig,
  patches: PatchOp[],
): Promise<JournalEntry[]> {
  return requestJson(config, '/journals', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patches),
  })
}
