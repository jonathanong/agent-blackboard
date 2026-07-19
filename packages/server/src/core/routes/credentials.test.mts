import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminEnv } from '../../auth/admin.mjs'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import type { HandlerRequest } from '../types.mjs'
import { handleCredentialsRoute } from './credentials.mjs'

async function collect(iter: AsyncIterable<string | Uint8Array>): Promise<string> {
  let out = ''
  for await (const chunk of iter)
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  return out
}

function adminEnv(): AdminEnv {
  return {
    AGENT_BLACKBOARD_ADMIN_CREDENTIALS: Buffer.from(
      JSON.stringify([{ name: 'root', token: 'abb_admin_root_secret' }]),
    ).toString('base64'),
  }
}

function baseRequest(overrides: Partial<HandlerRequest>): HandlerRequest {
  return { method: 'GET', path: '/credentials', query: {}, headers: {}, ...overrides }
}

describe('handleCredentialsRoute', () => {
  let store: MemoryBlackboardStore
  let env: AdminEnv

  beforeEach(() => {
    store = new MemoryBlackboardStore()
    env = adminEnv()
  })

  function withAuth(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
    return baseRequest({ headers: { authorization: 'Bearer abb_admin_root_secret' }, ...overrides })
  }

  describe('auth', () => {
    it('401s with no Authorization header', async () => {
      const response = await handleCredentialsRoute(baseRequest({}), store, env)
      expect(response.status).toBe(401)
    })

    it('401s for a client-shaped token', async () => {
      const { token } = await store.createCredential('agent-1')
      const response = await handleCredentialsRoute(
        baseRequest({ headers: { authorization: `Bearer ${token}` } }),
        store,
        env,
      )
      expect(response.status).toBe(401)
    })

    it('401s for a wrong admin token', async () => {
      const response = await handleCredentialsRoute(
        baseRequest({ headers: { authorization: 'Bearer abb_admin_root_wrongsecret' } }),
        store,
        env,
      )
      expect(response.status).toBe(401)
    })
  })

  it('404s for an unsupported method', async () => {
    const response = await handleCredentialsRoute(withAuth({ method: 'PATCH' }), store, env)
    expect(response.status).toBe(404)
  })

  describe('POST (create)', () => {
    it('creates a credential and returns the raw token once', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: '{"name":"agent-1"}' }),
        store,
        env,
      )
      expect(response.status).toBe(201)
      const body = JSON.parse(await collect(response.body))
      expect(body.name).toBe('agent-1')
      expect(body.token.startsWith('abb_sk_')).toBe(true)
      expect(body.tokenHash).toBeUndefined()
    })

    it('400s on invalid JSON', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: 'not json' }),
        store,
        env,
      )
      expect(response.status).toBe(400)
    })

    it('400s when the body is a JSON array (no .name)', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: '[1,2]' }),
        store,
        env,
      )
      expect(response.status).toBe(400)
    })

    it('400s when the body is a JSON primitive, not an object', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: '"just a string"' }),
        store,
        env,
      )
      expect(response.status).toBe(400)
    })

    it('400s when name is missing', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: '{}' }),
        store,
        env,
      )
      expect(response.status).toBe(400)
    })

    it('400s when name is not a string', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: '{"name":42}' }),
        store,
        env,
      )
      expect(response.status).toBe(400)
    })

    it('400s when name is empty', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'POST', body: '{"name":""}' }),
        store,
        env,
      )
      expect(response.status).toBe(400)
    })
  })

  describe('GET (list)', () => {
    it('lists credentials without tokens or hashes', async () => {
      await store.createCredential('a')
      await store.createCredential('b')
      const response = await handleCredentialsRoute(withAuth(), store, env)
      const body = JSON.parse(await collect(response.body))
      expect(body).toHaveLength(2)
      expect(body[0].token).toBeUndefined()
      expect(body[0].tokenHash).toBeUndefined()
    })
  })

  describe('DELETE', () => {
    it('deletes by id', async () => {
      const { record } = await store.createCredential('a')
      const response = await handleCredentialsRoute(
        withAuth({ method: 'DELETE', query: { id: record.id } }),
        store,
        env,
      )
      expect(response.status).toBe(200)
      expect(JSON.parse(await collect(response.body))).toEqual({ deleted: true })
    })

    it('deletes by name', async () => {
      await store.createCredential('by-name')
      const response = await handleCredentialsRoute(
        withAuth({ method: 'DELETE', query: { name: 'by-name' } }),
        store,
        env,
      )
      expect(response.status).toBe(200)
    })

    it('404s when nothing matches', async () => {
      const response = await handleCredentialsRoute(
        withAuth({ method: 'DELETE', query: { id: 'nope' } }),
        store,
        env,
      )
      expect(response.status).toBe(404)
    })

    it('400s when neither id nor name is given', async () => {
      const response = await handleCredentialsRoute(withAuth({ method: 'DELETE' }), store, env)
      expect(response.status).toBe(400)
    })
  })
})
