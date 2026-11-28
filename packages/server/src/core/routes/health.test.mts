import { describe, expect, it } from 'vitest'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import { handleRequest } from '../handle-request.mjs'
import { handleHealthRoute } from './health.mjs'

async function readJson(body: AsyncIterable<string | Uint8Array>): Promise<unknown> {
  let out = ''
  for await (const chunk of body) {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  }
  return JSON.parse(out)
}

describe('GET /health', () => {
  it('returns 200 for optional and shadow modes, and 404 for non-GET methods', async () => {
    const store = new MemoryBlackboardStore()
    const okRes = await handleHealthRoute(
      { method: 'GET', path: '/health', query: {}, headers: {} },
      store,
    )
    expect(okRes.status).toBe(200)
    expect(await readJson(okRes.body)).toEqual({
      status: 'ok',
      schemaEnforcement: { mode: 'optional', ready: true },
    })

    const postRes = await handleHealthRoute(
      { method: 'POST', path: '/health', query: {}, headers: {} },
      store,
    )
    expect(postRes.status).toBe(404)
  })

  it('returns 503 when required mode has no enforced schema, and 200 once one is promoted', async () => {
    const store = new MemoryBlackboardStore()
    const env = { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'required' }
    const req = { method: 'GET', path: '/health', query: {}, headers: {} }

    const unhealthy = await handleRequest(req, { store, now: () => new Date(0), env })
    expect(unhealthy.status).toBe(503)
    expect(unhealthy.headers['x-schema-registry-revision']).toBeUndefined()
    expect(await readJson(unhealthy.body)).toMatchObject({
      status: 'unhealthy',
      schemaEnforcement: {
        mode: 'required',
        ready: false,
        error: expect.stringMatching(/register and promote a schema.*shadow/),
      },
    })

    await store.putSchemaVersion({
      id: 'finding',
      schema: { type: 'object' },
      actor: 'ops',
      expectedVersion: 0,
      mode: 'shadow',
    })
    await store.promoteSchemaVersion('finding', 1, 'ops')

    const healthy = await handleRequest(req, { store, now: () => new Date(0), env })
    expect(healthy.status).toBe(200)
    expect(healthy.headers['x-schema-registry-revision']).toBeUndefined()
    expect(await readJson(healthy.body)).toEqual({
      status: 'ok',
      schemaEnforcement: { mode: 'required', ready: true },
    })
  })
})
