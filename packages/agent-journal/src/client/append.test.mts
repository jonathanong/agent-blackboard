import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { appendEntriesBatch, appendEntry } from './append.mjs'
import type { JournalEntry } from './types.mjs'

const ENTRY: JournalEntry = {
  id: 'a',
  sessionId: 's',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: { note: 'hi' },
}

describe('appendEntry', () => {
  it('posts a single entry and returns the created entry', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const result = await appendEntry(
        { baseUrl: fixture.baseUrl, token: 't' },
        { sessionId: 's', agent: 'claude-code', data: { note: 'hi' } },
      )
      expect(result).toEqual(ENTRY)
      const request = fixture.requests[0]!
      expect(request.method).toBe('POST')
      expect(request.headers['content-type']).toBe('application/json')
      expect(JSON.parse(request.body)).toEqual({
        sessionId: 's',
        agent: 'claude-code',
        data: { note: 'hi' },
      })
    } finally {
      await fixture.close()
    }
  })
})

describe('appendEntriesBatch', () => {
  it('posts an array and returns the created entries', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY, ENTRY]))
    try {
      const result = await appendEntriesBatch({ baseUrl: fixture.baseUrl, token: 't' }, [
        { sessionId: 's', agent: 'claude-code', data: {} },
        { sessionId: 's', agent: 'claude-code', data: {} },
      ])
      expect(result).toEqual([ENTRY, ENTRY])
      expect(JSON.parse(fixture.requests[0]!.body)).toHaveLength(2)
    } finally {
      await fixture.close()
    }
  })
})
