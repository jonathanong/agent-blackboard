import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from './__tests__/http-fixture.mjs'
import { AgentBlackboardError, Auth, Entries, Sessions } from './index.mjs'

describe('public API', () => {
  it('exports Sessions, Entries, Auth, and AgentBlackboardError', async () => {
    const session = {
      id: 's',
      parentSessionId: null,
      agent: 'test',
      version: '1',
      createdAt: 'now',
      lastEntryAt: null,
      archivedAt: null,
      data: {},
    }
    const fixture = await startHttpFixture((req, res) => {
      if (req.url.startsWith('/credentials')) return sendJson(res, 401, { message: 'admin only' })
      sendJson(res, req.method === 'POST' ? 201 : 200, session)
    })
    try {
      expect(
        await new Sessions({ baseUrl: fixture.baseUrl, token: 't' }).create({
          id: 's',
          parentSessionId: null,
          agent: 'test',
          version: '1',
        }),
      ).toEqual(session)
      expect(new Entries({ baseUrl: fixture.baseUrl, token: 't' })).toBeInstanceOf(Entries)
      await expect(
        new Auth({ baseUrl: fixture.baseUrl, adminToken: 'admin' }).listCredentials(),
      ).rejects.toBeInstanceOf(AgentBlackboardError)
    } finally {
      await fixture.close()
    }
  })
})
