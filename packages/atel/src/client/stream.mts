import { acceptHeaderFor, buildTelemetriesQuery, rawRequest } from './http.mjs'
import type { ClientConfig, GetEntriesQuery, GetRawQuery, TelemetryEntry } from './types.mjs'

/**
 * Issues `GET /telemetry` and returns the raw `Response`, without reading
 * the body. Used both for parsed-entry reads (below) and for the CLI's raw
 * passthrough of whatever wire format the user asked for.
 */
export async function fetchTelemetriesRaw(
  config: ClientConfig,
  query: GetRawQuery,
): Promise<Response> {
  const format = query.format ?? 'json'
  return rawRequest(config, '/telemetry', {
    method: 'GET',
    headers: { accept: acceptHeaderFor(format) },
    query: buildTelemetriesQuery(query),
  })
}

/**
 * Parses a `GET /telemetry` response body as newline-delimited JSON,
 * genuinely incrementally: each line is parsed and yielded as soon as it
 * has fully arrived, via the underlying `ReadableStream` reader — not after
 * buffering the whole response.
 */
export async function* parseNdjsonStream(response: Response): AsyncGenerator<TelemetryEntry> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (line.length > 0) yield JSON.parse(line) as TelemetryEntry
          newlineIndex = buffer.indexOf('\n')
        }
      }
      if (done) break
    }
    const trailing = buffer.trim()
    if (trailing.length > 0) yield JSON.parse(trailing) as TelemetryEntry
  } finally {
    reader.releaseLock()
  }
}

/**
 * Parses a `GET /telemetry` response body as a single JSON array. This
 * cannot be genuinely incremental — a JSON array isn't a valid JSON
 * document until its closing `]` arrives, so this buffers the full body
 * before yielding anything. Prefer `format: 'jsonl'` (the default) for real
 * incremental delivery; this path exists for parity with the server's
 * default wire format.
 */
export async function* parseJsonArrayBuffered(response: Response): AsyncGenerator<TelemetryEntry> {
  const text = (await response.text()).trim()
  if (text.length === 0) return
  const entries = JSON.parse(text) as TelemetryEntry[]
  for (const entry of entries) yield entry
}

/**
 * Reads `GET /telemetry` as parsed, structured entries. Always requests
 * `jsonl` on the wire by default (true incremental parsing); pass
 * `format: 'json'` to match the server's default array format instead, at
 * the cost of buffering the full response (see `parseJsonArrayBuffered`).
 */
export async function* streamEntries(
  config: ClientConfig,
  query: GetEntriesQuery = {},
): AsyncGenerator<TelemetryEntry> {
  const format = query.format ?? 'jsonl'
  const wireQuery: GetRawQuery = { format }
  if (query.sessionId !== undefined) wireQuery.sessionId = query.sessionId
  if (query.agent !== undefined) wireQuery.agent = query.agent
  if (query.archived !== undefined) wireQuery.archived = query.archived
  const response = await fetchTelemetriesRaw(config, wireQuery)
  if (format === 'jsonl') {
    yield* parseNdjsonStream(response)
  } else {
    yield* parseJsonArrayBuffered(response)
  }
}
