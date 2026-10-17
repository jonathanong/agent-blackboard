import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { dispatchTool } from './dispatch.mjs'
import { toolSessionId, toolSessionIdentity } from './session-resolution.mjs'

const cwd = '/nonexistent-agent-blackboard-mcp'
const resolution = { env: { CLAUDE_CODE_SESSION_ID: 'ambient' }, cwd }

describe('toolSessionId', () => {
  it('passes explicit ids through and resolves omitted ones', () => {
    expect(toolSessionId({ sessionId: 'a.b' }, resolution)).toBe('a.b')
    expect(toolSessionId({}, resolution)).toBe('ambient')
  })

  it('requires sessionId without a resolution context, and rejects empty explicit ids', () => {
    expect(() => toolSessionId({}, undefined)).toThrow('"sessionId" must be a non-empty string.')
    expect(() => toolSessionId({ sessionId: '' }, resolution)).toThrow('"sessionId" must be')
    expect(() => toolSessionId({}, { env: {}, cwd })).toThrow(/no session id/)
  })
})

describe('toolSessionIdentity', () => {
  it('resolves whichever of sessionId and agent is missing', () => {
    expect(toolSessionIdentity({}, resolution)).toEqual({
      agent: 'claude-code',
      sessionId: 'ambient',
    })
    expect(toolSessionIdentity({ sessionId: 'x.y' }, resolution)).toEqual({
      agent: 'claude-code',
      sessionId: 'x.y',
    })
    expect(toolSessionIdentity({ agent: 'custom' }, resolution)).toEqual({
      agent: 'custom',
      sessionId: 'ambient',
    })
    expect(toolSessionIdentity({ sessionId: 's', agent: 'a' }, { env: {}, cwd })).toEqual({
      agent: 'a',
      sessionId: 's',
    })
  })

  it('requires both without a resolution context', () => {
    expect(() => toolSessionIdentity({ sessionId: 's' }, undefined)).toThrow('"agent" must be')
    expect(() => toolSessionIdentity({ agent: 'a' }, undefined)).toThrow('"sessionId" must be')
  })
})

describe('dispatch with a resolution context', () => {
  it('appends, reads, creates and ensures without an explicit sessionId', async () => {
    const session = {
      id: 'ambient',
      parentSessionId: null,
      agent: 'claude-code',
      version: '1',
      data: {},
      createdAt: 'now',
      archivedAt: null,
      lastEntryAt: null,
    }
    const fixture = await startHttpFixture((req, res) => {
      if (req.method === 'GET') {
        res.end('[]')
        return
      }
      if (req.url === '/sessions') {
        sendJson(res, 201, session)
        return
      }
      sendJson(res, 201, { sessionId: 'ambient', createdAt: 'now', data: {} })
    })
    try {
      const config = { baseUrl: fixture.baseUrl, token: 't' }
      await dispatchTool('entry_append', { data: {} }, config, resolution)
      await dispatchTool('entry_get', {}, config, resolution)
      const create = { parentSessionId: null, version: '1' }
      await dispatchTool('session_create', create, config, resolution)
      await dispatchTool('session_ensure', create, config, resolution)
      const urls = fixture.requests.map((r) => `${r.method} ${r.url.split('?')[0]}`)
      expect(urls).toContain('POST /sessions/ambient/entries')
      expect(urls).toContain('GET /sessions/ambient/entries')
      const bodies = fixture.requests
        .filter((r) => r.body.includes('version'))
        .map((r) => JSON.parse(r.body))
      expect(bodies).toHaveLength(2)
      for (const body of bodies) expect(body).toMatchObject({ id: 'ambient', agent: 'claude-code' })
    } finally {
      await fixture.close()
    }
  })
})
