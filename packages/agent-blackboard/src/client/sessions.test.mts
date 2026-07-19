import { describe, expect, it } from 'vitest'
import { startHttpFixture, sendJson } from '../__tests__/http-fixture.mjs'
import { Sessions } from './sessions.mjs'

describe('Sessions', () => {
  it('creates, lists, gets, and archives sessions', async () => {
    const session = {
      id: 's/1',
      parentSessionId: null,
      agent: 'test',
      version: '1',
      createdAt: 'now',
      archivedAt: null,
      data: {},
    }
    const fixture = await startHttpFixture((req, res) => {
      sendJson(
        res,
        req.method === 'POST' ? 201 : 200,
        req.url === '/sessions' && req.method === 'GET' ? [session] : session,
      )
    })
    try {
      const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
      expect(
        await sessions.create({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
      ).toEqual(session)
      expect(await sessions.list()).toEqual([session])
      expect(await sessions.get('s/1')).toEqual(session)
      expect(await sessions.patch({ sessionId: 's/1', data: { branch: 'main' } })).toEqual(session)
      expect(await sessions.archive('s/1')).toEqual(session)
      expect(fixture.requests.map((request) => request.url)).toEqual([
        '/sessions',
        '/sessions',
        '/sessions/s%2F1',
        '/sessions/s%2F1',
        '/sessions/s%2F1',
      ])
      expect(JSON.parse(fixture.requests[3]!.body)).toEqual({ data: { branch: 'main' } })
      expect(JSON.parse(fixture.requests[4]!.body)).toEqual({ archived: true })
    } finally {
      await fixture.close()
    }
  })
})
