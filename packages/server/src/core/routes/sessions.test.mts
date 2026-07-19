import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import type { HandlerRequest } from '../types.mjs'
import { handleSessionsRoute } from './sessions.mjs'

const NOW = new Date('2026-01-01T00:00:00.000Z')

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
      request({ method: 'POST', body: { id: 'root', parentSessionId: null } }),
      store,
    )
    expect(rootResponse.status).toBe(201)
    expect(await body(rootResponse)).toMatchObject({ id: 'root', parentSessionId: null })
    const childResponse = await handleSessionsRoute(
      request({ method: 'POST', body: { id: 'child', parentSessionId: 'root' } }),
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
    for (const invalid of ['bad json', [], {}, { id: 'a/b', parentSessionId: null }]) {
      const response = await handleSessionsRoute(request({ method: 'POST', body: invalid }), store)
      expect(response.status).toBe(400)
    }
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: { id: 's', parentSessionId: 1 } }),
          store,
        )
      ).status,
    ).toBe(400)
    await handleSessionsRoute(
      request({ method: 'POST', body: { id: 'root', parentSessionId: null } }),
      store,
    )
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: { id: 'root', parentSessionId: null } }),
          store,
        )
      ).status,
    ).toBe(409)
    expect(
      (
        await handleSessionsRoute(
          request({ method: 'POST', body: { id: 'child', parentSessionId: 'missing' } }),
          store,
        )
      ).status,
    ).toBe(404)
  })

  it('archives sessions and validates archive bodies', async () => {
    await store.createSession({
      credId: (await store.listCredentials())[0]!.id,
      id: 's',
      parentSessionId: null,
    })
    expect(
      (await handleSessionsRoute(request({ method: 'PATCH', body: 'bad' }), store, 's')).status,
    ).toBe(400)
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
        request({ method: 'POST', body: { id: 's', parentSessionId: null } }),
        store,
      ),
    ).rejects.toBe(boom)
    vi.spyOn(store, 'archiveSession').mockRejectedValueOnce(boom)
    await expect(
      handleSessionsRoute(request({ method: 'PATCH', body: { archived: true } }), store, 's'),
    ).rejects.toBe(boom)
  })
})
