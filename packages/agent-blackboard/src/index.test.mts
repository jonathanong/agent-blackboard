import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from './__tests__/http-fixture.mjs'
import { AgentBlackboardError, Auth, Entries, formatError, Sessions } from './index.mjs'

describe('public API', () => {
  it('exports Sessions, Entries, Auth, AgentBlackboardError, and formatError', async () => {
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

  it('formats errors through the package root', () => {
    expect(
      formatError(new AgentBlackboardError('request failed', 401, { message: 'bad token' })),
    ).toBe('request failed {"message":"bad token"}')
  })

  it('preserves the message of an Error with a cause through the package root', () => {
    expect(formatError(new Error('outer failure', { cause: new Error('inner failure') }))).toBe(
      'outer failure',
    )
  })

  it('uses deterministic fallbacks for values that cannot be formatted through the package root', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    expect(formatError(new AgentBlackboardError('request failed', 400, { value: 1n }))).toBe(
      'request failed [unserializable error body]',
    )
    expect(formatError(new AgentBlackboardError('request failed', 400, circular))).toBe(
      'request failed [unserializable error body]',
    )
    expect(formatError(new AgentBlackboardError('request failed', 400, Symbol('body')))).toBe(
      'request failed [unserializable error body]',
    )
    expect(formatError(Object.create(null))).toBe('[unprintable error]')
  })
})
