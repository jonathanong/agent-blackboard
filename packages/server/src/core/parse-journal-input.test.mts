import { describe, expect, it } from 'vitest'
import { parseJournalEntriesBody } from './parse-journal-input.mjs'

describe('parseJournalEntriesBody', () => {
  it('parses a single JSON object', async () => {
    const result = await parseJournalEntriesBody(
      '{"sessionId":"s1","agent":"claude","data":{"a":1}}',
    )
    expect(result).toEqual({
      ok: true,
      entries: [{ sessionId: 's1', agent: 'claude', data: { a: 1 } }],
    })
  })

  it('defaults data to {} when omitted', async () => {
    const result = await parseJournalEntriesBody('{"sessionId":"s1","agent":"claude"}')
    expect(result).toEqual({ ok: true, entries: [{ sessionId: 's1', agent: 'claude', data: {} }] })
  })

  it('parses a JSON array of entries', async () => {
    const body = JSON.stringify([
      { sessionId: 's1', agent: 'claude' },
      { sessionId: 's2', agent: 'codex' },
    ])
    const result = await parseJournalEntriesBody(body)
    expect(result.ok).toBe(true)
    expect(result.ok && result.entries.length).toBe(2)
  })

  it('parses NDJSON (newline-delimited JSON)', async () => {
    const body = '{"sessionId":"s1","agent":"claude"}\n{"sessionId":"s2","agent":"codex"}\n'
    const result = await parseJournalEntriesBody(body)
    expect(result.ok).toBe(true)
    expect(result.ok && result.entries.map((e) => e.sessionId)).toEqual(['s1', 's2'])
  })

  it('ignores blank lines in NDJSON', async () => {
    const body = '{"sessionId":"s1","agent":"claude"}\n\n{"sessionId":"s2","agent":"codex"}'
    const result = await parseJournalEntriesBody(body)
    expect(result.ok).toBe(true)
    expect(result.ok && result.entries.length).toBe(2)
  })

  it('accepts an already-parsed single object body', async () => {
    const result = await parseJournalEntriesBody({ sessionId: 's1', agent: 'claude' })
    expect(result).toEqual({ ok: true, entries: [{ sessionId: 's1', agent: 'claude', data: {} }] })
  })

  it('accepts an already-parsed array body', async () => {
    const result = await parseJournalEntriesBody([
      { sessionId: 's1', agent: 'claude' },
      { sessionId: 's2', agent: 'codex' },
    ])
    expect(result.ok).toBe(true)
    expect(result.ok && result.entries.length).toBe(2)
  })

  it('rejects an empty body', async () => {
    const result = await parseJournalEntriesBody(undefined)
    expect(result).toEqual({ ok: false, error: 'at least one entry is required' })
  })

  it('rejects an empty array', async () => {
    const result = await parseJournalEntriesBody('[]')
    expect(result).toEqual({ ok: false, error: 'at least one entry is required' })
  })

  it('rejects invalid JSON and invalid NDJSON', async () => {
    const result = await parseJournalEntriesBody('not json at all\nstill not json')
    expect(result.ok).toBe(false)
  })

  it('rejects an entry missing sessionId', async () => {
    const result = await parseJournalEntriesBody('{"agent":"claude"}')
    expect(result.ok).toBe(false)
  })

  it('rejects an entry missing agent', async () => {
    const result = await parseJournalEntriesBody('{"sessionId":"s1"}')
    expect(result.ok).toBe(false)
  })

  it('rejects an entry with an empty sessionId', async () => {
    const result = await parseJournalEntriesBody('{"sessionId":"","agent":"claude"}')
    expect(result.ok).toBe(false)
  })

  it('rejects an entry whose data is not an object', async () => {
    const result = await parseJournalEntriesBody(
      '{"sessionId":"s1","agent":"claude","data":"nope"}',
    )
    expect(result.ok).toBe(false)
  })

  it('rejects an entry whose data is an array', async () => {
    const result = await parseJournalEntriesBody('{"sessionId":"s1","agent":"claude","data":[1,2]}')
    expect(result.ok).toBe(false)
  })

  it('rejects a non-object item in an array body', async () => {
    const result = await parseJournalEntriesBody('[42]')
    expect(result.ok).toBe(false)
  })
})
