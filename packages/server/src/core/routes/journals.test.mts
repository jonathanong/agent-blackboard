import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryJournalStore } from '../../store/memory.mjs'
import type { HandlerRequest } from '../types.mjs'
import { handleJournalsRoute } from './journals.mjs'

async function collect(iter: AsyncIterable<string | Uint8Array>): Promise<string> {
  let out = ''
  for await (const chunk of iter)
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  return out
}

function baseRequest(overrides: Partial<HandlerRequest>): HandlerRequest {
  return { method: 'GET', path: '/journals', query: {}, headers: {}, ...overrides }
}

describe('handleJournalsRoute', () => {
  let store: MemoryJournalStore
  let token: string
  let credId: string

  beforeEach(async () => {
    store = new MemoryJournalStore()
    const created = await store.createCredential('agent-1')
    token = created.token
    credId = created.record.id
  })

  function withAuth(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
    return baseRequest({ headers: { authorization: `Bearer ${token}` }, ...overrides })
  }

  describe('auth', () => {
    it('401s with no Authorization header', async () => {
      const response = await handleJournalsRoute(baseRequest({}), store)
      expect(response.status).toBe(401)
    })

    it('401s for an admin-shaped token', async () => {
      const response = await handleJournalsRoute(
        baseRequest({ headers: { authorization: 'Bearer ag_admin_alice_secret' } }),
        store,
      )
      expect(response.status).toBe(401)
    })

    it('401s for a journaling token with the wrong secret', async () => {
      const response = await handleJournalsRoute(
        baseRequest({ headers: { authorization: `Bearer ${token}wrong` } }),
        store,
      )
      expect(response.status).toBe(401)
    })
  })

  it('404s for an unsupported method', async () => {
    const response = await handleJournalsRoute(withAuth({ method: 'DELETE' }), store)
    expect(response.status).toBe(404)
  })

  describe('POST', () => {
    it('appends a single entry and returns it', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'POST', body: '{"sessionId":"s1","agent":"claude","data":{"a":1}}' }),
        store,
      )
      expect(response.status).toBe(201)
      const created = JSON.parse(await collect(response.body))
      expect(created).toHaveLength(1)
      expect(created[0].sessionId).toBe('s1')
      expect(created[0].data).toEqual({ a: 1 })
    })

    it('appends an array of entries', async () => {
      const body = JSON.stringify([
        { sessionId: 's1', agent: 'claude' },
        { sessionId: 's1', agent: 'claude' },
      ])
      const response = await handleJournalsRoute(withAuth({ method: 'POST', body }), store)
      const created = JSON.parse(await collect(response.body))
      expect(created).toHaveLength(2)
    })

    it('400s on an invalid body', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'POST', body: 'not json' }),
        store,
      )
      expect(response.status).toBe(400)
    })
  })

  describe('GET', () => {
    beforeEach(async () => {
      await store.appendEntry({ credId, sessionId: 's1', agent: 'claude', data: { note: 'hi' } })
    })

    it('defaults to a JSON array', async () => {
      const response = await handleJournalsRoute(withAuth(), store)
      expect(response.headers['content-type']).toBe('application/json')
      const body = JSON.parse(await collect(response.body))
      expect(Array.isArray(body)).toBe(true)
    })

    it('supports format=jsonl', async () => {
      const response = await handleJournalsRoute(withAuth({ query: { format: 'jsonl' } }), store)
      expect(response.headers['content-type']).toBe('application/x-ndjson')
    })

    it('supports format=markdown', async () => {
      const response = await handleJournalsRoute(withAuth({ query: { format: 'markdown' } }), store)
      expect(response.headers['content-type']).toBe('text/markdown')
    })

    it('400s on an invalid format', async () => {
      const response = await handleJournalsRoute(withAuth({ query: { format: 'yaml' } }), store)
      expect(response.status).toBe(400)
    })

    it('filters by archived=true/false', async () => {
      const trueResponse = await handleJournalsRoute(
        withAuth({ query: { archived: 'true' } }),
        store,
      )
      const falseResponse = await handleJournalsRoute(
        withAuth({ query: { archived: 'false' } }),
        store,
      )
      expect(JSON.parse(await collect(trueResponse.body))).toEqual([])
      expect(JSON.parse(await collect(falseResponse.body))).toHaveLength(1)
    })

    it('400s on an invalid archived value', async () => {
      const response = await handleJournalsRoute(withAuth({ query: { archived: 'maybe' } }), store)
      expect(response.status).toBe(400)
    })

    it('filters by sessionId and agent', async () => {
      const response = await handleJournalsRoute(
        withAuth({ query: { sessionId: 's1', agent: 'claude' } }),
        store,
      )
      expect(JSON.parse(await collect(response.body))).toHaveLength(1)
    })
  })

  describe('PATCH', () => {
    it('merges data and sets archived', async () => {
      const entry = await store.appendEntry({ credId, sessionId: 's1', agent: 'claude', data: {} })
      const body = JSON.stringify([{ id: entry.id, archived: true, data: { pr: 7777 } }])
      const response = await handleJournalsRoute(withAuth({ method: 'PATCH', body }), store)
      expect(response.status).toBe(200)
      const [updated] = JSON.parse(await collect(response.body))
      expect(updated.archived).toBe(true)
      expect(updated.data).toEqual({ pr: 7777 })
    })

    it('400s on invalid JSON', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: 'not json' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a non-array body', async () => {
      const response = await handleJournalsRoute(withAuth({ method: 'PATCH', body: '{}' }), store)
      expect(response.status).toBe(400)
    })

    it('400s on an empty array', async () => {
      const response = await handleJournalsRoute(withAuth({ method: 'PATCH', body: '[]' }), store)
      expect(response.status).toBe(400)
    })

    it('400s on a patch with neither archived nor data', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":"x"}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('accepts a patch with only archived set', async () => {
      const entry = await store.appendEntry({ credId, sessionId: 's1', agent: 'claude', data: {} })
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: JSON.stringify([{ id: entry.id, archived: true }]) }),
        store,
      )
      expect(response.status).toBe(200)
    })

    it('accepts a patch with only a non-empty data set', async () => {
      const entry = await store.appendEntry({ credId, sessionId: 's1', agent: 'claude', data: {} })
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: JSON.stringify([{ id: entry.id, data: { a: 1 } }]) }),
        store,
      )
      expect(response.status).toBe(200)
    })

    it('400s on a patch whose id is not a non-empty string', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":42,"archived":true}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a patch whose id is an empty string', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":"","archived":true}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a patch whose archived is not a boolean', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":"x","archived":"true"}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a patch whose data is not an object', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":"x","data":"nope"}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a patch whose data is an array', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":"x","data":[1]}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a patch with an empty data object and no archived', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '[{"id":"x","data":{}}]' }),
        store,
      )
      expect(response.status).toBe(400)
    })

    it('400s on a non-object patch item', async () => {
      const response = await handleJournalsRoute(
        withAuth({ method: 'PATCH', body: '["x"]' }),
        store,
      )
      expect(response.status).toBe(400)
    })
  })
})
