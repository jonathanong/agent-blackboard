import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleJournalAppend } from './tool-append.mjs'

const ENTRY = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: { note: 'hi' },
}

describe('handleJournalAppend', () => {
  it('appends using the given sessionId/agent and returns the created entry', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const result = await handleJournalAppend(
        { data: { note: 'hi' }, sessionId: 's1', agent: 'claude-code' },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
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

  it('defaults agent to claude-code and resolves sessionId when omitted', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      await handleJournalAppend({ data: {} }, { baseUrl: fixture.baseUrl, token: 't' })
      const body = JSON.parse(fixture.requests[0]!.body) as { sessionId: string; agent: string }
      expect(body.agent).toBe('claude-code')
      expect(typeof body.sessionId).toBe('string')
      expect(body.sessionId.length).toBeGreaterThan(0)
    } finally {
      await fixture.close()
    }
  })

  it('throws when data is missing or not an object', async () => {
    const config = { baseUrl: 'http://h/', token: 't' }
    await expect(handleJournalAppend({}, config)).rejects.toThrow('"data" must be an object.')
    await expect(handleJournalAppend({ data: 'x' }, config)).rejects.toThrow(
      '"data" must be an object.',
    )
  })
})
