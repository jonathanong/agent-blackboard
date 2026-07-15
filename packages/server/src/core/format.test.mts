import { describe, expect, it } from 'vitest'
import { formatEntries, FORMAT_CONTENT_TYPE, resolveFormat } from './format.mjs'
import type { JournalEntry } from './types.mjs'

async function* entries(list: JournalEntry[]): AsyncGenerator<JournalEntry> {
  for (const entry of list) yield entry
}

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const chunk of iter) out += chunk
  return out
}

const ENTRY: JournalEntry = {
  id: 's1#01',
  credId: 'cred1',
  sessionId: 's1',
  agent: 'claude',
  createdAt: '2024-01-01T00:00:00.000Z',
  archived: false,
  data: { note: 'hello' },
  ttl: 123,
}

describe('resolveFormat', () => {
  it('uses ?format= when valid', () => {
    expect(resolveFormat({ format: 'jsonl' }, {})).toBe('jsonl')
    expect(resolveFormat({ format: 'markdown' }, {})).toBe('markdown')
    expect(resolveFormat({ format: 'json' }, {})).toBe('json')
  })

  it('returns undefined for an invalid ?format=', () => {
    expect(resolveFormat({ format: 'xml' }, {})).toBeUndefined()
  })

  it('falls back to Accept: application/x-ndjson', () => {
    expect(resolveFormat({}, { accept: 'application/x-ndjson' })).toBe('jsonl')
  })

  it('falls back to Accept: text/markdown', () => {
    expect(resolveFormat({}, { accept: 'text/markdown' })).toBe('markdown')
  })

  it('defaults to json for an unrecognized/absent Accept', () => {
    expect(resolveFormat({}, {})).toBe('json')
    expect(resolveFormat({}, { accept: 'application/json' })).toBe('json')
  })
})

describe('formatEntries', () => {
  it('json: streams a valid JSON array, including the empty-array case', async () => {
    expect(await collect(formatEntries('json', entries([])))).toBe('[]')
    expect(JSON.parse(await collect(formatEntries('json', entries([ENTRY, ENTRY]))))).toEqual([
      ENTRY,
      ENTRY,
    ])
  })

  it('jsonl: one JSON object per line', async () => {
    const text = await collect(formatEntries('jsonl', entries([ENTRY, ENTRY])))
    const lines = text.trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0] ?? '')).toEqual(ENTRY)
  })

  it('markdown: a heading and fenced JSON block per entry', async () => {
    const text = await collect(formatEntries('markdown', entries([ENTRY])))
    expect(text).toContain('## 2024-01-01T00:00:00.000Z — session s1 (claude)')
    expect(text).toContain('```json')
    expect(text).toContain('"note": "hello"')
  })

  it('exposes a content-type per format', () => {
    expect(FORMAT_CONTENT_TYPE.json).toBe('application/json')
    expect(FORMAT_CONTENT_TYPE.jsonl).toBe('application/x-ndjson')
    expect(FORMAT_CONTENT_TYPE.markdown).toBe('text/markdown')
  })
})
