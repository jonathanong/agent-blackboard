import { requestJson } from './http.mjs'
import type { AppendInput, ClientConfig, TelemetryEntry } from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** Posts a single telemetry entry. `POST /telemetry` echoes back the created entry. */
export async function appendEntry(
  config: ClientConfig,
  input: AppendInput,
): Promise<TelemetryEntry> {
  return requestJson(config, '/telemetry', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  })
}

/** Posts a batch of telemetry entries. `POST /telemetry` echoes back the created entries. */
export async function appendEntriesBatch(
  config: ClientConfig,
  inputs: AppendInput[],
): Promise<TelemetryEntry[]> {
  return requestJson(config, '/telemetry', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(inputs),
  })
}
