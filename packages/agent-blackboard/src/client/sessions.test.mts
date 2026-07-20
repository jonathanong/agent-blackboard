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
        req.url === '/sessions' && req.method === 'GET'
          ? { sessions: [session], nextCursor: null }
          : session,
      )
    })
    try {
      const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
      expect(
        await sessions.create({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
      ).toEqual(session)
      expect(await sessions.list()).toEqual({ sessions: [session], nextCursor: null })
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

  it('builds a full querystring from every listSessions filter', async () => {
    const fixture = await startHttpFixture((req, res) => {
      sendJson(res, 200, { sessions: [], nextCursor: null })
    })
    try {
      const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
      await sessions.list({
        archived: true,
        agent: 'claude-code',
        version: '1.0.13',
        parentSessionId: null,
        data: { branch: 'main' },
        limit: 5,
        cursor: 'opaque-cursor',
      })
      const url = new URL(fixture.requests[0]!.url, 'http://localhost')
      expect(url.pathname).toBe('/sessions')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        archived: 'true',
        agent: 'claude-code',
        version: '1.0.13',
        parentSessionId: '',
        data: JSON.stringify({ branch: 'main' }),
        limit: '5',
        cursor: 'opaque-cursor',
      })
    } finally {
      await fixture.close()
    }
  })

  it('passes a non-null parentSessionId through the querystring verbatim', async () => {
    const fixture = await startHttpFixture((req, res) => {
      sendJson(res, 200, { sessions: [], nextCursor: null })
    })
    try {
      const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
      await sessions.list({ parentSessionId: 'root-session' })
      const url = new URL(fixture.requests[0]!.url, 'http://localhost')
      expect(Object.fromEntries(url.searchParams)).toEqual({ parentSessionId: 'root-session' })
    } finally {
      await fixture.close()
    }
  })

  it('sends no query params for an empty listSessions query', async () => {
    const fixture = await startHttpFixture((req, res) => {
      sendJson(res, 200, { sessions: [], nextCursor: null })
    })
    try {
      const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
      await sessions.list()
      expect(fixture.requests[0]!.url).toBe('/sessions')
    } finally {
      await fixture.close()
    }
  })
})
