import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from './__tests__/http-fixture.mjs'
import { AgentJournalError, Auth, Journal, Journals, resolveSessionId } from './index.mjs'

describe('public API surface', () => {
  it('exports Journal, Journals, Auth, AgentJournalError, and resolveSessionId wired to the same client', async () => {
    const created = {
      id: 'a',
      sessionId: 's1',
      agent: 'claude-code',
      createdAt: 'now',
      archived: false,
      data: { note: 'hi' },
    }
    const fixture = await startHttpFixture((req, res) => {
      if (req.url.startsWith('/credentials')) {
        sendJson(res, 401, { message: 'admin only' })
        return
      }
      sendJson(res, 200, created)
    })
    try {
      const journal = new Journal({
        baseUrl: fixture.baseUrl,
        token: 't',
        sessionId: resolveSessionId('s1'),
      })
      expect(await journal.append({ note: 'hi' })).toEqual(created)

      const journals = new Journals({ baseUrl: fixture.baseUrl, token: 't' })
      expect(
        await journals.append({ sessionId: 's1', agent: 'claude-code', data: { note: 'hi' } }),
      ).toEqual(created)

      const auth = new Auth({ baseUrl: fixture.baseUrl, adminToken: 'admin' })
      await expect(auth.listCredentials()).rejects.toBeInstanceOf(AgentJournalError)
    } finally {
      await fixture.close()
    }
  })
})
