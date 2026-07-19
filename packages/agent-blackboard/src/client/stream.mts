import { acceptHeaderFor, buildEntriesQuery, rawRequest } from './http.mjs'
import type { ClientConfig, GetEntriesQuery, GetRawEntriesQuery, SessionEntry } from './types.mjs'

export function getEntriesRaw(config: ClientConfig, query: GetRawEntriesQuery): Promise<Response> {
  const format = query.format ?? 'json'
  return rawRequest(config, `/sessions/${encodeURIComponent(query.sessionId)}/entries`, {
    method: 'GET',
    headers: { accept: acceptHeaderFor(format) },
    query: buildEntriesQuery(query.format),
  })
}

export async function* parseNdjsonStream(response: Response): AsyncGenerator<SessionEntry> {
  if (!response.body) return
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += value
      const lines = buffered.split('\n')
      buffered = lines.pop()!
      for (const line of lines) if (line.length > 0) yield JSON.parse(line) as SessionEntry
    }
    if (buffered.length > 0) yield JSON.parse(buffered) as SessionEntry
  } finally {
    reader.releaseLock()
  }
}

export async function* parseJsonArrayBuffered(response: Response): AsyncGenerator<SessionEntry> {
  const text = await response.text()
  if (text.length === 0) return
  const entries = JSON.parse(text) as SessionEntry[]
  for (const entry of entries) yield entry
}

export async function* streamEntries(
  config: ClientConfig,
  query: GetEntriesQuery,
): AsyncGenerator<SessionEntry> {
  const format = query.format ?? 'jsonl'
  const response = await getEntriesRaw(config, { ...query, format })
  yield* format === 'jsonl' ? parseNdjsonStream(response) : parseJsonArrayBuffered(response)
}
