import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import type { Session } from '../client/types.mjs'
import {
  handleSessionArchive,
  handleSessionCreate,
  handleSessionPatch,
  handleSessionSearch,
} from './tool-sessions.mjs'

it('creates roots/children and archives explicit sessions', async () => {
  const session = {
    id: 's',
    parentSessionId: null,
    agent: 'test',
    version: '1',
    createdAt: 'now',
    archivedAt: null,
    data: {},
  }
  const child = {
    ...session,
    id: 'child',
    parentSessionId: 's',
    agent: 'other',
    data: { branch: 'dev', nested: { ok: true } },
  }
  const fixture = await startHttpFixture((req, res) =>
    sendJson(
      res,
      200,
      req.method === 'GET' ? { sessions: [session, child], nextCursor: null } : session,
    ),
  )
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
    expect(await handleSessionSearch({}, config)).toEqual({ sessions: [session, child] })
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
    ).toEqual({ sessions: [child] })
    expect(await handleSessionSearch({ parentSessionId: null }, config)).toEqual({
      sessions: [session],
    })
    for (const args of [
      { sessionId: 'missing' },
      { parentSessionId: 'missing' },
      { agent: 'missing' },
      { version: 'missing' },
      { data: { branch: 'missing' } },
    ]) {
      expect(await handleSessionSearch(args, config)).toEqual({ sessions: [] })
    }
    expect(await handleSessionSearch({ archived: 0 }, config)).toEqual({
      sessions: [session, child],
    })
    expect(fixture.requests.at(-1)?.url).toBe('/sessions?archived=false')
    expect(await handleSessionSearch({ archived: 1 }, config)).toEqual({
      sessions: [session, child],
    })
    expect(fixture.requests.at(-1)?.url).toBe('/sessions?archived=true')
    for (const archived of [-1, 2, false, true, '0']) {
      await expect(handleSessionSearch({ archived }, config)).rejects.toThrow('0 or 1')
    }
    await expect(handleSessionSearch({ sessionId: 1 }, config)).rejects.toThrow('sessionId')
    await expect(handleSessionSearch({ parentSessionId: 1 }, config)).rejects.toThrow(
      'parentSessionId',
    )
    await expect(handleSessionSearch({ data: [] }, config)).rejects.toThrow('data')
    expect(await handleSessionArchive({ sessionId: 's' }, config)).toEqual(session)
    expect(() => handleSessionCreate({ sessionId: 's' }, config)).toThrow()
  } finally {
    await fixture.close()
  }
})

it('drains every listSessions page before filtering, so a match on page 2 is found', async () => {
  function session(overrides: Partial<Session>): Session {
    return {
      id: 's',
      parentSessionId: null,
      agent: 'test',
      version: '1',
      createdAt: 'now',
      archivedAt: null,
      data: {},
      ...overrides,
    }
  }
  const first = session({ id: 'first' })
  const second = session({ id: 'second', agent: 'other' })
  const fixture = await startHttpFixture((req, res) => {
    const hasCursor = new URL(req.url, 'http://localhost').searchParams.has('cursor')
    sendJson(
      res,
      200,
      hasCursor
        ? { sessions: [second], nextCursor: null }
        : { sessions: [first], nextCursor: 'page-2' },
    )
  })
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    expect(await handleSessionSearch({ agent: 'other' }, config)).toEqual({ sessions: [second] })
    expect(fixture.requests.map((request) => request.url)).toEqual([
      '/sessions?archived=false',
      '/sessions?archived=false&cursor=page-2',
    ])
  } finally {
    await fixture.close()
  }
})
