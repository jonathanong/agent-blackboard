import { describe, expect, it } from 'vitest'
import { MemoryBlackboardStore } from '../store/memory.mjs'
import { handleRequest } from './handle-request.mjs'
import type { HandleRequestDeps } from './handle-request.mjs'
import type { HandlerRequest } from './types.mjs'

function deps(overrides: Partial<HandleRequestDeps> = {}): HandleRequestDeps {
  return {
    store: new MemoryBlackboardStore(),
    now: () => new Date('2024-01-01T00:00:00.000Z'),
    env: {},
    ...overrides,
  }
}

function request(overrides: Partial<HandlerRequest>): HandlerRequest {
  return { method: 'GET', path: '/nope', query: {}, headers: {}, ...overrides }
}

describe('handleRequest', () => {
  it('404s an unknown path', async () => {
    const response = await handleRequest(request({ path: '/nope' }), deps())
    expect(response.status).toBe(404)
  })

  it('404s the root path', async () => {
    const response = await handleRequest(request({ path: '/' }), deps())
    expect(response.status).toBe(404)
  })

  it('normalizes a trailing slash before matching a route', async () => {
    const response = await handleRequest(request({ path: '/sessions/' }), deps())
    // No auth header -> still routed to the sessions handler (401), not 404.
    expect(response.status).toBe(401)
  })

  it('routes nested entry paths to the entry handler', async () => {
    const response = await handleRequest(request({ path: '/sessions/s1/entries' }), deps())
    expect(response.status).toBe(401)
  })

  it('routes one-session paths to the session handler', async () => {
    const response = await handleRequest(request({ path: '/sessions/s1' }), deps())
    expect(response.status).toBe(401)
  })

  it('routes /credentials to the credentials handler', async () => {
    const response = await handleRequest(request({ path: '/credentials' }), deps())
    expect(response.status).toBe(401)
  })

  it('decodes a percent-encoded session id before it reaches the store', async () => {
    // Mirrors what a real adapter hands in: url.pathname preserves
    // percent-encoding rather than decoding it, so a client that
    // encodeURIComponent()s an id containing ':' arrives here as '%3A'.
    const store = new MemoryBlackboardStore()
    const { token } = await store.createCredential('test')
    const credId = (await store.listCredentials())[0]!.id
    await store.createSession({
      credId,
      id: 'abc:def',
      parentSessionId: null,
      agent: 'claude-code',
      version: '1.0.0',
    })
    const headers = { authorization: `Bearer ${token}` }

    const sessionResponse = await handleRequest(
      request({ path: '/sessions/abc%3Adef', headers }),
      deps({ store }),
    )
    expect(sessionResponse.status).toBe(200)

    const entriesResponse = await handleRequest(
      request({ path: '/sessions/abc%3Adef/entries', headers }),
      deps({ store }),
    )
    expect(entriesResponse.status).toBe(200)
  })
})
