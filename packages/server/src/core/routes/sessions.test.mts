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
    expect(await body(listResponse)).toHaveLength(2)
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
    expect(await body(await handleSessionsRoute(request(), store))).toEqual([])
    expect(
      await body(await handleSessionsRoute(request({ query: { archived: 'true' } }), store)),
    ).toHaveLength(1)
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
  })
})
