import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { dispatchTool } from './dispatch.mjs'

it('dispatches every entry/session tool and rejects unknown names', async () => {
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
  const entry = { sessionId: 's', createdAt: 'now', data: {} }
  const fixture = await startHttpFixture((req, res) => {
    if (req.method === 'GET') {
      const isSessionsList = new URL(req.url, 'http://localhost').pathname === '/sessions'
      return sendJson(res, 200, isSessionsList ? { sessions: [entry], nextCursor: null } : [entry])
    }
    sendJson(res, 200, req.url.endsWith('/entries') ? entry : session)
  })
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    await expect(
      dispatchTool(
        'session_create',
        { sessionId: 's', parentSessionId: null, agent: 'test', version: '1' },
        config,
      ),
    ).resolves.toEqual(session)
    await expect(dispatchTool('session_archive', { sessionId: 's' }, config)).resolves.toEqual(
      session,
    )
    await expect(
      dispatchTool('session_patch', { sessionId: 's', data: { branch: 'main' } }, config),
    ).resolves.toEqual(session)
    await expect(dispatchTool('session_search', {}, config)).resolves.toEqual({
      sessions: [entry],
      nextCursor: null,
    })
    await expect(
      dispatchTool('entry_append', { sessionId: 's', data: {} }, config),
    ).resolves.toEqual(entry)
    await expect(
      dispatchTool('entry_get', { sessionId: 's', format: 'json' }, config),
    ).resolves.toEqual({ entries: [entry] })
    expect(() => dispatchTool('nope', {}, config)).toThrow('Unknown tool: nope')
  } finally {
    await fixture.close()
  }
})
