import { requestJson } from './http.mjs'
import type { AppendInput, ClientConfig, JournalEntry } from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** Posts a single journal entry. `POST /journals` echoes back the created entry. */
export async function appendEntry(config: ClientConfig, input: AppendInput): Promise<JournalEntry> {
  return requestJson(config, '/journals', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  })
}

/** Posts a batch of journal entries. `POST /journals` echoes back the created entries. */
export async function appendEntriesBatch(
  config: ClientConfig,
  inputs: AppendInput[],
): Promise<JournalEntry[]> {
  return requestJson(config, '/journals', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(inputs),
  })
}
