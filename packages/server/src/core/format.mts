import { formatJson } from './format-json.mjs'
import { formatJsonl } from './format-jsonl.mjs'
import { formatMarkdown } from './format-markdown.mjs'
import type { HeaderMap, QueryMap, SessionEntry } from './types.mjs'

export type EntryFormat = 'json' | 'jsonl' | 'markdown'

export const FORMAT_CONTENT_TYPE: Record<EntryFormat, string> = {
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  markdown: 'text/markdown',
}

const VALID_FORMATS: EntryFormat[] = ['json', 'jsonl', 'markdown']

/**
 * Resolves the output format for an entry read: `?format=` wins if present
 * (returns `undefined` if it's not one of `json|jsonl|markdown` — callers
 * should respond 400); otherwise falls back to a simple `Accept` substring
 * check (`application/x-ndjson` -> jsonl, `text/markdown` -> markdown, else
 * json). Headers are expected pre-lowercased per the `HeaderMap` contract.
 */
export function resolveFormat(query: QueryMap, headers: HeaderMap): EntryFormat | undefined {
  const requested = query.format
  if (requested !== undefined) {
    return (VALID_FORMATS as string[]).includes(requested) ? (requested as EntryFormat) : undefined
  }
  const accept = headers.accept ?? ''
  if (accept.includes('application/x-ndjson')) return 'jsonl'
  if (accept.includes('text/markdown')) return 'markdown'
  return 'json'
}

export function formatEntries(
  format: EntryFormat,
  entries: AsyncIterable<SessionEntry>,
): AsyncIterable<string> {
  if (format === 'jsonl') return formatJsonl(entries)
  if (format === 'markdown') return formatMarkdown(entries)
  return formatJson(entries)
}
