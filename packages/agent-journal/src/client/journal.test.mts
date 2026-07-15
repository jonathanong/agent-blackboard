import { describe, expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { Journal } from './journal.mjs'
import type { JournalEntry } from './types.mjs'

const ENTRY: JournalEntry = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: {},
}

describe('Journal', () => {
  it('uses the explicit sessionId and defaults agent to claude-code', async () => {
    const journal = new Journal({ baseUrl: 'http://example.invalid/', token: 't', sessionId: 's1' })
    expect(journal.sessionId).toBe('s1')
    expect(journal.agent).toBe('claude-code')
  })

  it('accepts a custom agent', () => {
    const journal = new Journal({
      baseUrl: 'http://example.invalid/',
      token: 't',
      sessionId: 's1',
      agent: 'codex',
    })
    expect(journal.agent).toBe('codex')
  })

  it('append() posts { sessionId, agent, data } and returns the created entry', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const journal = new Journal({ baseUrl: fixture.baseUrl, token: 't', sessionId: 's1' })
      const result = await journal.append({ note: 'hi' })
      expect(result).toEqual(ENTRY)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({
        sessionId: 's1',
        agent: 'claude-code',
        data: { note: 'hi' },
      })
    } finally {
      await fixture.close()
    }
  })

  it('get() with no options streams this session/agent with no archived/format filter', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, [ENTRY]))
    try {
      const journal = new Journal({ baseUrl: fixture.baseUrl, token: 't', sessionId: 's1' })
      const entries: JournalEntry[] = []
      for await (const entry of journal.get()) entries.push(entry)
      expect(entries).toEqual([ENTRY])
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(url.searchParams.get('sessionId')).toBe('s1')
      expect(url.searchParams.get('agent')).toBe('claude-code')
      expect(url.searchParams.get('archived')).toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it('get() forwards archived and format when provided', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY]))
    try {
      const journal = new Journal({ baseUrl: fixture.baseUrl, token: 't', sessionId: 's1' })
      const entries: JournalEntry[] = []
      for await (const entry of journal.get({ archived: false, format: 'json' }))
        entries.push(entry)
      expect(entries).toEqual([ENTRY])
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(url.searchParams.get('archived')).toBe('false')
      expect(url.searchParams.get('format')).toBe('json')
    } finally {
      await fixture.close()
    }
  })
})
