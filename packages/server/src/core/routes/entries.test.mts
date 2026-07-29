import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import { SessionStoreError } from '../../store/errors.mjs'
import type { HandlerRequest } from '../types.mjs'
import { handleEntriesRoute } from './entries.mjs'

async function collect(iter: AsyncIterable<string | Uint8Array>): Promise<string> {
  let result = ''
  for await (const chunk of iter) result += chunk.toString()
  return result
}

describe('entries route', () => {
  let store: MemoryBlackboardStore
  let token: string
  let credId: string

  beforeEach(async () => {
    store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })
    const credential = await store.createCredential('test')
    token = credential.token
    credId = credential.record.id
    await store.createSession({
      credId,
      id: 's',
      parentSessionId: null,
      agent: 'test-agent',
      version: '1.0.0',
    })
  })

  function request(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
    return {
      method: 'GET',
      path: '/sessions/s/entries',
      query: {},
      headers: { authorization: `Bearer ${token}` },
      ...overrides,
    }
  }

  async function json(response: Awaited<ReturnType<typeof handleEntriesRoute>>): Promise<unknown> {
    return JSON.parse(await collect(response.body))
  }

  it('rejects unauthenticated and unsupported requests', async () => {
    expect((await handleEntriesRoute(request({ headers: {} }), store, 's')).status).toBe(401)
    expect((await handleEntriesRoute(request({ method: 'DELETE' }), store, 's')).status).toBe(404)
  })

  it('appends and streams entries before and after archival', async () => {
    const appendedResponse = await handleEntriesRoute(
      request({ method: 'POST', body: { data: { marker: 'x' } } }),
      store,
      's',
    )
    expect(appendedResponse.status).toBe(201)
    const listed = await handleEntriesRoute(request({ query: { format: 'json' } }), store, 's')
    expect(await json(listed)).toHaveLength(1)
    const jsonl = await handleEntriesRoute(request({ query: { format: 'jsonl' } }), store, 's')
    expect(await collect(jsonl.body)).toContain('"marker":"x"')
    await store.archiveSession(credId, 's')
    expect(
      (await handleEntriesRoute(request({ method: 'POST', body: { data: {} } }), store, 's'))
        .status,
    ).toBe(201)
    expect((await handleEntriesRoute(request(), store, 's')).status).toBe(200)
  })

  it('validates append and format inputs', async () => {
    for (const body of ['bad', [], {}, { data: [] }]) {
      expect((await handleEntriesRoute(request({ method: 'POST', body }), store, 's')).status).toBe(
        400,
      )
    }
    const oversized = 'a'.repeat(380 * 1024 + 1)
    expect(
      (await handleEntriesRoute(request({ method: 'POST', body: oversized }), store, 's')).status,
    ).toBe(413)
    expect(
      (await handleEntriesRoute(request({ query: { format: 'yaml' } }), store, 's')).status,
    ).toBe(400)
    expect(
      (await handleEntriesRoute(request({ method: 'POST', body: { data: {} } }), store, 'missing'))
        .status,
    ).toBe(404)
    expect((await handleEntriesRoute(request(), store, 'missing')).status).toBe(404)
  })

  it('propagates unexpected store failures', async () => {
    const boom = new Error('boom')
    vi.spyOn(store, 'appendEntry').mockRejectedValueOnce(boom)
    await expect(
      handleEntriesRoute(request({ method: 'POST', body: { data: {} } }), store, 's'),
    ).rejects.toBe(boom)
  })

  it('maps a timestamp_exhausted store error to 503', async () => {
    vi.spyOn(store, 'appendEntry').mockRejectedValueOnce(
      new SessionStoreError('timestamp_exhausted', 'could not allocate'),
    )
    const response = await handleEntriesRoute(
      request({ method: 'POST', body: { data: {} } }),
      store,
      's',
    )
    expect(response.status).toBe(503)
  })
})
