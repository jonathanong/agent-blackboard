import { requestJson } from './http.mjs'
import type { ClientConfig, PatchOp, TelemetryEntry } from './types.mjs'

/**
 * Batch-patches telemetry entries. `data` is a shallow merge into each
 * entry's existing `data` blob, not a replace.
 */
export async function patchEntries(
  config: ClientConfig,
  patches: PatchOp[],
): Promise<TelemetryEntry[]> {
  return requestJson(config, '/telemetry', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patches),
  })
}
