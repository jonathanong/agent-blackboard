import { readRawBodyText } from './body.mjs'
import type { TelemetryEntryInput, RequestBody } from './types.mjs'

/** A validated entry ready to append — unlike `TelemetryEntryInput`, `data` is always populated (defaulted to `{}`), never `undefined`. */
interface ParsedTelemetryEntry {
  sessionId: string
  agent: string
  data: Record<string, unknown>
}

export type ParseResult =
  | { ok: true; entries: ParsedTelemetryEntry[] }
  | { ok: false; error: string }

function isValidEntryInput(value: unknown): value is TelemetryEntryInput {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0) return false
  if (typeof candidate.agent !== 'string' || candidate.agent.length === 0) return false
  if (candidate.data !== undefined) {
    if (
      typeof candidate.data !== 'object' ||
      candidate.data === null ||
      Array.isArray(candidate.data)
    )
      return false
  }
  return true
}

async function resolveRawItems(body: RequestBody): Promise<unknown[] | undefined> {
  const text = await readRawBodyText(body)
  if (text === undefined) return Array.isArray(body) ? body : [body]
  if (text.trim().length === 0) return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    try {
      return lines.map((line) => JSON.parse(line))
    } catch {
      return undefined
    }
  }
}

/**
 * Parses the `POST /telemetry` body: one entry object, an array of entries,
 * or newline-delimited JSON (one entry per line) — see `body.mts` for how
 * an already-parsed body (object/array) is handled without needing raw text.
 */
export async function parseTelemetryEntriesBody(body: RequestBody): Promise<ParseResult> {
  const rawItems = await resolveRawItems(body)
  if (!rawItems) {
    return {
      ok: false,
      error: 'body must be a JSON object, a JSON array, or newline-delimited JSON',
    }
  }
  if (rawItems.length === 0) return { ok: false, error: 'at least one entry is required' }
  const entries: ParsedTelemetryEntry[] = []
  for (const item of rawItems) {
    if (!isValidEntryInput(item)) {
      return {
        ok: false,
        error: 'each entry requires a non-empty sessionId and agent, and an optional object data',
      }
    }
    entries.push({ sessionId: item.sessionId, agent: item.agent, data: item.data ?? {} })
  }
  return { ok: true, entries }
}
