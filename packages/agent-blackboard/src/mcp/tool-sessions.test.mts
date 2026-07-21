import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import type { Session } from '../client/types.mjs'
import {
  handleSessionArchive,
  handleSessionCreate,
  handleSessionPatch,
  handleSessionSearch,
} from './tool-sessions.mjs'

const session: Session = {
  id: 's',
  parentSessionId: null,
  agent: 'test',
  version: '1',
  createdAt: 'now',
  archivedAt: null,
  data: {},
}

const child: Session = {
  ...session,
  id: 'child',
  parentSessionId: 's',
  agent: 'other',
  data: { branch: 'dev', nested: { ok: true } },
}

const archivedSession: Session = {
  ...session,
  id: 'archived',
  archivedAt: 'later',
}

/**
 * Routes `GET /sessions/<id>` to a direct-get response ("missing" 404s, "error-session" 500s),
 * `GET /sessions` (list, no id segment) to the list envelope, and any other method (POST/PATCH,
 * used by create/patch/archive) to a bare `session`.
 */
function startSessionsFixture() {
  return startHttpFixture((req, res) => {
    const url = new URL(req.url as string, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/sessions/child') {
      return sendJson(res, 200, child)
    }
    if (req.method === 'GET' && url.pathname === '/sessions/s') {
      return sendJson(res, 200, session)
    }
    if (req.method === 'GET' && url.pathname === '/sessions/archived') {
      return sendJson(res, 200, archivedSession)
    }
    if (req.method === 'GET' && url.pathname === '/sessions/missing') {
      return sendJson(res, 404, { error: 'not found' })
    }
    if (req.method === 'GET' && url.pathname === '/sessions/error-session') {
      return sendJson(res, 500, { error: 'boom' })
    }
    if (req.method === 'GET' && url.pathname === '/sessions') {
      return sendJson(res, 200, { sessions: [session, child], nextCursor: null })
    }
    return sendJson(res, 200, session)
  })
}

it('creates, patches, and archives explicit sessions', async () => {
  const fixture = await startSessionsFixture()
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    expect(
      await handleSessionCreate(
        { sessionId: 's', parentSessionId: null, agent: 'test', version: '1' },
        config,
      ),
    ).toEqual(session)
    expect(await handleSessionPatch({ sessionId: 's', data: { branch: 'main' } }, config)).toEqual(
      session,
    )
    expect(() => handleSessionPatch({ sessionId: 's', data: {} }, config)).toThrow('non-empty')
    expect(await handleSessionArchive({ sessionId: 's' }, config)).toEqual(session)
    expect(() => handleSessionCreate({ sessionId: 's' }, config)).toThrow()
  } finally {
    await fixture.close()
  }
})

it('session_search without sessionId forwards filters and pagination straight to the server', async () => {
  const fixture = await startSessionsFixture()
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }

    expect(await handleSessionSearch({}, config)).toEqual({
      sessions: [session, child],
      nextCursor: null,
    })
    expect(fixture.requests.at(-1)?.url).toBe('/sessions?archived=false')

    expect(await handleSessionSearch({ archived: 1 }, config)).toEqual({
      sessions: [session, child],
      nextCursor: null,
    })
    expect(fixture.requests.at(-1)?.url).toBe('/sessions?archived=true')

    for (const archived of [-1, 2, false, true, '0']) {
      await expect(handleSessionSearch({ archived }, config)).rejects.toThrow('0 or 1')
    }

    await handleSessionSearch({ parentSessionId: null }, config)
    expect(
      new URL(fixture.requests.at(-1)!.url, 'http://localhost').searchParams.get('parentSessionId'),
    ).toBe('')

    await handleSessionSearch({ agent: 'other' }, config)
    expect(
      new URL(fixture.requests.at(-1)!.url, 'http://localhost').searchParams.get('agent'),
    ).toBe('other')

    await handleSessionSearch({ version: '1' }, config)
    expect(
      new URL(fixture.requests.at(-1)!.url, 'http://localhost').searchParams.get('version'),
    ).toBe('1')

    await handleSessionSearch({ data: { branch: 'dev' } }, config)
    expect(new URL(fixture.requests.at(-1)!.url, 'http://localhost').searchParams.get('data')).toBe(
      JSON.stringify({ branch: 'dev' }),
    )
  } finally {
    await fixture.close()
  }
})

it('passes limit and cursor straight through and returns the server page without draining', async () => {
  const fixture = await startHttpFixture((req, res) =>
    sendJson(res, 200, { sessions: [session], nextCursor: 'page-2' }),
  )
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    const result = await handleSessionSearch({ limit: 5, cursor: 'page-1' }, config)
    expect(result).toEqual({ sessions: [session], nextCursor: 'page-2' })
    expect(fixture.requests).toHaveLength(1)
    const url = new URL(fixture.requests[0]!.url, 'http://localhost')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('cursor')).toBe('page-1')
  } finally {
    await fixture.close()
  }
})

it('session_search with sessionId does a direct get and filters in-process, never listing', async () => {
  const fixture = await startSessionsFixture()
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }

    expect(
      await handleSessionSearch(
        {
          sessionId: 'child',
          parentSessionId: 's',
          agent: 'other',
          version: '1',
          data: { nested: { ok: true } },
        },
        config,
      ),
    ).toEqual({ sessions: [child], nextCursor: null })

    for (const badArgs of [
      { sessionId: 'child', parentSessionId: 'nope' },
      { sessionId: 'child', agent: 'nope' },
      { sessionId: 'child', version: 'nope' },
      { sessionId: 'child', data: { branch: 'nope' } },
    ]) {
      expect(await handleSessionSearch(badArgs, config)).toEqual({
        sessions: [],
        nextCursor: null,
      })
    }

    expect(await handleSessionSearch({ sessionId: 'missing' }, config)).toEqual({
      sessions: [],
      nextCursor: null,
    })

    expect(await handleSessionSearch({ sessionId: 'archived', archived: 1 }, config)).toEqual({
      sessions: [archivedSession],
      nextCursor: null,
    })
    expect(await handleSessionSearch({ sessionId: 'archived' }, config)).toEqual({
      sessions: [],
      nextCursor: null,
    })

    await expect(handleSessionSearch({ sessionId: 'error-session' }, config)).rejects.toThrow('500')

    expect(fixture.requests.some((request) => request.url === '/sessions')).toBe(false)
    expect(fixture.requests.some((request) => request.url.startsWith('/sessions?'))).toBe(false)
  } finally {
    await fixture.close()
  }
})

it('validates sessionId/parentSessionId/data/limit/cursor input types', async () => {
  const fixture = await startSessionsFixture()
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    await expect(handleSessionSearch({ sessionId: 1 }, config)).rejects.toThrow('sessionId')
    await expect(handleSessionSearch({ parentSessionId: 1 }, config)).rejects.toThrow(
      'parentSessionId',
    )
    await expect(handleSessionSearch({ data: [] }, config)).rejects.toThrow('data')
    for (const limit of [0, -1, '5']) {
      await expect(handleSessionSearch({ limit }, config)).rejects.toThrow('limit')
    }
    await expect(handleSessionSearch({ cursor: 123 }, config)).rejects.toThrow('cursor')
  } finally {
    await fixture.close()
  }
})
