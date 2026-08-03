import { describe, expect, it } from 'vitest'
import { startHttpFixture, sendJson } from '../__tests__/http-fixture.mjs'
import { Sessions } from './sessions.mjs'

const BASE_SESSION = {
  id: 's/1',
  parentSessionId: null,
  agent: 'test',
  version: '1',
  createdAt: 'now',
  lastEntryAt: null,
  archivedAt: null,
  data: {},
}

describe('Sessions', () => {
  it('creates, lists, gets, and archives sessions', async () => {
    const session = {
      id: 's/1',
      parentSessionId: null,
      agent: 'test',
      version: '1',
      createdAt: 'now',
      lastEntryAt: null,
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
        inactiveForHours: 8,
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
        inactiveForHours: '8',
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

  describe('ensure', () => {
    it('returns created on a clean create', async () => {
      const fixture = await startHttpFixture((_req, res) => sendJson(res, 201, BASE_SESSION))
      try {
        const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
        await expect(
          sessions.ensure({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
        ).resolves.toEqual({ status: 'created', session: BASE_SESSION })
      } finally {
        await fixture.close()
      }
    })

    it('returns exists when a 409 conflict matches every compared field', async () => {
      const fixture = await startHttpFixture((req, res) => {
        if (req.method === 'POST') return sendJson(res, 409, { error: 'session exists' })
        sendJson(res, 200, BASE_SESSION)
      })
      try {
        const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
        await expect(
          sessions.ensure({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
        ).resolves.toEqual({ status: 'exists', session: BASE_SESSION })
      } finally {
        await fixture.close()
      }
    })

    it('throws naming the differing fields when a 409 conflict mismatches', async () => {
      const fixture = await startHttpFixture((req, res) => {
        if (req.method === 'POST') return sendJson(res, 409, { error: 'session exists' })
        sendJson(res, 200, { ...BASE_SESSION, agent: 'other', version: '2' })
      })
      try {
        const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
        await expect(
          sessions.ensure({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
        ).rejects.toThrow(/agent: expected "test", got "other".*version: expected "1", got "2"/s)
      } finally {
        await fixture.close()
      }
    })

    it('rethrows non-409 errors from create without a follow-up get', async () => {
      const fixture = await startHttpFixture((_req, res) => sendJson(res, 500, { error: 'boom' }))
      try {
        const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
        await expect(
          sessions.ensure({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
        ).rejects.toThrow('-> 500')
        expect(fixture.requests).toHaveLength(1)
      } finally {
        await fixture.close()
      }
    })

    it('normalizes an undefined parentSessionId to null when comparing', async () => {
      const fixture = await startHttpFixture((req, res) => {
        if (req.method === 'POST') return sendJson(res, 409, { error: 'session exists' })
        const { parentSessionId: _omit, ...rest } = BASE_SESSION
        sendJson(res, 200, rest)
      })
      try {
        const sessions = new Sessions({ baseUrl: fixture.baseUrl, token: 't' })
        await expect(
          sessions.ensure({ id: 's/1', parentSessionId: null, agent: 'test', version: '1' }),
        ).resolves.toMatchObject({ status: 'exists' })
      } finally {
        await fixture.close()
      }
    })
  })
})
