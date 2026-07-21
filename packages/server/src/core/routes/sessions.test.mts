import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import type { HandlerRequest } from '../types.mjs'
import { handleSessionsRoute } from './sessions.mjs'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const AGENT = { agent: 'claude-code', version: '1.0.13' }

async function collect(iter: AsyncIterable<string | Uint8Array>): Promise<string> {
  let result = ''
  for await (const chunk of iter) result += chunk.toString()
  return result
}

describe('sessions route', () => {
  let store: MemoryBlackboardStore
  let token: string

  beforeEach(async () => {
    store = new MemoryBlackboardStore({ now: () => NOW })
    token = (await store.createCredential('test')).token
  })

  function request(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
    return {
      method: 'GET',
      path: '/sessions',
      query: {},
      headers: { authorization: `Bearer ${token}` },
      ...overrides,
    }
  }

  async function body(response: Awaited<ReturnType<typeof handleSessionsRoute>>): Promise<unknown> {
    return JSON.parse(await collect(response.body))
  }

  it('rejects unauthenticated and unsupported requests', async () => {
    expect((await handleSessionsRoute(request({ headers: {} }), store)).status).toBe(401)
    expect((await handleSessionsRoute(request({ method: 'DELETE' }), store)).status).toBe(404)
    expect((await handleSessionsRoute(request({ method: 'POST' }), store, 's')).status).toBe(404)
  })

  it('creates roots and children, then lists and gets them', async () => {
    const rootResponse = await handleSessionsRoute(
      request({ method: 'POST', body: { id: 'root', parentSessionId: null, ...AGENT } }),
      store,
    )
    expect(rootResponse.status).toBe(201)
    expect(await body(rootResponse)).toMatchObject({
      id: 'root',
      parentSessionId: null,
      data: {},
      ...AGENT,
    })
    const childResponse = await handleSessionsRoute(
      request({ method: 'POST', body: { id: 'child', parentSessionId: 'root', ...AGENT } }),
      store,
    )
    expect(childResponse.status).toBe(201)
    const listResponse = await handleSessionsRoute(request(), store)
    // Both share the frozen NOW clock, so listSessions's (createdAt, id) sort
    // ties on createdAt and falls back to id ordering: 'child' < 'root'.
    expect(await body(listResponse)).toMatchObject({
      sessions: [{ id: 'child' }, { id: 'root' }],
      nextCursor: null,
    })
    expect(await body(await handleSessionsRoute(request(), store, 'child'))).toMatchObject({
      parentSessionId: 'root',
    })
    expect((await handleSessionsRoute(request(), store, 'missing')).status).toBe(404)
  })

  it('validates create bodies and maps store conflicts', async () => {
    for (const invalid of [
      'bad json',
      [],
      {},
      { id: 'a/b', parentSessionId: null, ...AGENT },
      { id: 's', parentSessionId: null, agent: '', version: '1' },
      { id: 's', parentSessionId: null, agent: 'test', version: '' },
    ]) {
      const response = await handleSessionsRoute(request({ method: 'POST', body: invalid }), store)
      expect(response.status).toBe(400)
    }
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: 'a'.repeat(380 * 1024 + 1) }),
          store,
        )
      ).status,
    ).toBe(413)
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: { id: 's', parentSessionId: 1, ...AGENT } }),
          store,
        )
      ).status,
    ).toBe(400)
    await handleSessionsRoute(
      request({ method: 'POST', body: { id: 'root', parentSessionId: null, ...AGENT } }),
      store,
    )
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: { id: 'root', parentSessionId: null, ...AGENT } }),
          store,
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: { id: 'child', parentSessionId: 'missing', ...AGENT } }),
          store,
        )
      ).status,
    ).toBe(404)
  })

  it('patches and archives sessions, then filters archived lists', async () => {
    await store.createSession({
      credId: (await store.listCredentials())[0]!.id,
      id: 's',
      parentSessionId: null,
      ...AGENT,
    })
    expect(
      (await handleSessionsRoute(request({ method: 'PATCH', body: 'bad' }), store, 's')).status,
    ).toBe(400)
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'PATCH', body: 'a'.repeat(380 * 1024 + 1) }),
          store,
          's',
        )
      ).status,
    ).toBe(413)
    expect(
      (await handleSessionsRoute(request({ method: 'PATCH', body: [1, 2] }), store, 's')).status,
    ).toBe(400)
    expect(
      (await handleSessionsRoute(request({ method: 'PATCH', body: { data: {} } }), store, 's'))
        .status,
    ).toBe(400)
    const patched = await handleSessionsRoute(
      request({ method: 'PATCH', body: { data: { branch: 'main' } } }),
      store,
      's',
    )
    expect(await body(patched)).toMatchObject({ data: { branch: 'main' } })
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'PATCH', body: { archived: false } }),
          store,
          's',
        )
      ).status,
    ).toBe(400)
    const archived = await handleSessionsRoute(
      request({ method: 'PATCH', body: { archived: true } }),
      store,
      's',
    )
    expect(await body(archived)).toMatchObject({ archivedAt: NOW.toISOString() })
    expect(await body(await handleSessionsRoute(request(), store))).toMatchObject({
      sessions: [],
      nextCursor: null,
    })
    expect(
      await body(await handleSessionsRoute(request({ query: { archived: 'true' } }), store)),
    ).toMatchObject({ sessions: [{ id: 's' }] })
    expect((await handleSessionsRoute(request({ query: { archived: 'all' } }), store)).status).toBe(
      400,
    )
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'PATCH', body: { data: { late: true } } }),
          store,
          's',
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'PATCH', body: { archived: true } }),
          store,
          'missing',
        )
      ).status,
    ).toBe(404)
  })

  it('rejects invalid list query params with 400 before ever touching the store', async () => {
    for (const query of [
      { limit: '0' },
      { limit: '-1' },
      { limit: '1.5' },
      { limit: '201' },
      { data: 'not json' },
      { data: '[1,2]' },
    ]) {
      expect((await handleSessionsRoute(request({ query }), store)).status).toBe(400)
    }
  })

  it('rejects a malformed cursor with a 400 invalid_cursor error', async () => {
    const response = await handleSessionsRoute(
      request({ query: { cursor: 'not-a-real-cursor' } }),
      store,
    )
    expect(response.status).toBe(400)
  })

  it('filters listed sessions by agent, version, and parentSessionId', async () => {
    const credId = (await store.listCredentials())[0]!.id
    await store.createSession({ credId, id: 'root', parentSessionId: null, ...AGENT })
    await store.createSession({
      credId,
      id: 'child',
      parentSessionId: 'root',
      agent: AGENT.agent,
      version: '2.0.0',
    })
    await store.createSession({
      credId,
      id: 'other',
      parentSessionId: null,
      agent: 'other-agent',
      version: AGENT.version,
    })

    expect(
      await body(await handleSessionsRoute(request({ query: { agent: 'other-agent' } }), store)),
    ).toMatchObject({ sessions: [{ id: 'other' }] })
    expect(
      await body(await handleSessionsRoute(request({ query: { version: '2.0.0' } }), store)),
    ).toMatchObject({ sessions: [{ id: 'child' }] })
    expect(
      await body(await handleSessionsRoute(request({ query: { parentSessionId: 'root' } }), store)),
    ).toMatchObject({ sessions: [{ id: 'child' }] })
    // Tied on the frozen NOW clock again: 'other' < 'root'.
    expect(
      await body(await handleSessionsRoute(request({ query: { parentSessionId: '' } }), store)),
    ).toMatchObject({ sessions: [{ id: 'other' }, { id: 'root' }] })
  })

  it('pages through listed sessions via nextCursor without loss or duplication', async () => {
    const credId = (await store.listCredentials())[0]!.id
    const created: string[] = []
    for (let i = 0; i < 5; i += 1) {
      await store.createSession({ credId, id: `s${i}`, parentSessionId: null, ...AGENT })
      created.push(`s${i}`)
    }

    const seen = new Set<string>()
    let cursor: string | undefined
    let iterations = 0
    do {
      const query: Record<string, string> =
        cursor === undefined ? { limit: '2' } : { limit: '2', cursor }
      const page = (await body(await handleSessionsRoute(request({ query }), store))) as {
        sessions: { id: string }[]
        nextCursor: string | null
      }
      for (const session of page.sessions) seen.add(session.id)
      cursor = page.nextCursor ?? undefined
      iterations += 1
      expect(iterations).toBeLessThanOrEqual(created.length + 1)
    } while (cursor !== undefined)

    expect(seen).toEqual(new Set(created))
  })

  it('propagates unexpected store failures', async () => {
    const boom = new Error('boom')
    vi.spyOn(store, 'createSession').mockRejectedValueOnce(boom)
    await expect(
      handleSessionsRoute(
        request({ method: 'POST', body: { id: 's', parentSessionId: null, ...AGENT } }),
        store,
      ),
    ).rejects.toBe(boom)
    vi.spyOn(store, 'archiveSession').mockRejectedValueOnce(boom)
    await expect(
      handleSessionsRoute(request({ method: 'PATCH', body: { archived: true } }), store, 's'),
    ).rejects.toBe(boom)
    vi.spyOn(store, 'patchSession').mockRejectedValueOnce(boom)
    await expect(
      handleSessionsRoute(
        request({ method: 'PATCH', body: { data: { branch: 'main' } } }),
        store,
        's',
      ),
    ).rejects.toBe(boom)
    vi.spyOn(store, 'listSessions').mockRejectedValueOnce(boom)
    await expect(handleSessionsRoute(request(), store)).rejects.toBe(boom)
  })
})
