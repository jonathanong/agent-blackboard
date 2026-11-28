import { formatError } from '../format-error.mjs'
import { isRetryableAppendError } from '../outbox/classify.mjs'
import { enqueueOutboxEntry } from '../outbox/store.mjs'
import { requestJson } from './http.mjs'
import type {
  AppendEntryInput,
  AppendEntryResult,
  ClientConfig,
  StoredEntryResult,
} from './types.mjs'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** Sends `POST /sessions/:id/entries` directly without outbox fallback. */
export async function sendAppendEntry(
  config: ClientConfig,
  input: AppendEntryInput,
): Promise<StoredEntryResult> {
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

export async function appendEntry(
  config: ClientConfig,
  input: AppendEntryInput,
): Promise<AppendEntryResult> {
  try {
    return await sendAppendEntry(config, input)
  } catch (error) {
    if (config.outboxDir !== undefined && isRetryableAppendError(error)) {
      const record = enqueueOutboxEntry(config.outboxDir, input, formatError(error))
      return {
        queued: true,
        outboxId: record.id,
        sessionId: record.sessionId,
        data: record.data,
        ...(record.schemaId !== undefined ? { schemaId: record.schemaId } : {}),
        ...(record.schemaVersion !== undefined ? { schemaVersion: record.schemaVersion } : {}),
        sourceEventId: record.sourceEventId,
        queuedAt: record.queuedAt,
        error: record.lastError,
      }
    }
    throw error
  }
}
