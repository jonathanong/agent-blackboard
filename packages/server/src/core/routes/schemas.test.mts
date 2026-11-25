import { describe, expect, it, vi } from 'vitest'
import { SessionStoreError } from '../../store/errors.mjs'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import { handleRequest } from '../handle-request.mjs'
import type { HandlerRequest, HandlerResponse } from '../types.mjs'
import { etagMatches, SCHEMA_REVISION_HEADER } from './schemas-etag.mjs'

const ADMIN_TOKEN = 'abb_admin_ops_secret123'
const ADMIN_ENV = {
  AGENT_BLACKBOARD_ADMIN_CREDENTIALS: Buffer.from(
    JSON.stringify([{ name: 'ops', token: ADMIN_TOKEN }]),
  ).toString('base64'),
}

async function readBody(response: HandlerResponse): Promise<string> {
  let out = ''
  for await (const chunk of response.body) {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  }
  return out
}

async function readJson(response: HandlerResponse): Promise<Record<string, unknown>> {
  return JSON.parse(await readBody(response)) as Record<string, unknown>
}

function makeReq(overrides: Partial<HandlerRequest>): HandlerRequest {
  return { method: 'GET', path: '/schemas', query: {}, headers: {}, ...overrides }
}

async function setup() {
  const store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })
  const { token: clientToken } = await store.createCredential('agent')
  const deps = { store, now: () => new Date('2026-01-01T00:00:00.000Z'), env: ADMIN_ENV }
  return {
    store,
    deps,
    adminAuth: { authorization: `Bearer ${ADMIN_TOKEN}` },
    clientAuth: { authorization: `Bearer ${clientToken}` },
  }
}

describe('/schemas routes', () => {
  it('enforces auth: admin for writes, client or admin for reads', async () => {
    const { deps, adminAuth, clientAuth } = await setup()
    expect((await handleRequest(makeReq({}), deps)).status).toBe(401)
    expect((await handleRequest(makeReq({ method: 'PUT', path: '/schemas/a' }), deps)).status).toBe(
      401,
    )
    expect(
      (
        await handleRequest(
          makeReq({ method: 'PUT', path: '/schemas/a', headers: clientAuth, body: { schema: {} } }),
          deps,
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handleRequest(
          makeReq({ method: 'DELETE', path: '/schemas/a', headers: clientAuth }),
          deps,
        )
      ).status,
    ).toBe(401)

    expect((await handleRequest(makeReq({ headers: clientAuth }), deps)).status).toBe(200)
    expect((await handleRequest(makeReq({ headers: adminAuth }), deps)).status).toBe(200)
    expect(
      (await handleRequest(makeReq({ method: 'POST', path: '/schemas', headers: adminAuth }), deps))
        .status,
    ).toBe(404)
    expect(
      (
        await handleRequest(
          makeReq({ method: 'POST', path: '/schemas/a', headers: adminAuth }),
          deps,
        )
      ).status,
    ).toBe(404)
  })

  it('publishes immutable versions, checks compatibility, records audit, and serves reads + 304', async () => {
    const { deps, adminAuth, clientAuth } = await setup()

    // Initial list at rev 0 + ETag / If-None-Match 304
    const list0 = await handleRequest(makeReq({ headers: clientAuth }), deps)
    expect(list0.status).toBe(200)
    expect(list0.headers[SCHEMA_REVISION_HEADER]).toBe('0')
    expect(list0.headers.etag).toBe('"rev-0"')
    expect(await readJson(list0)).toEqual({ revision: 0, schemas: [] })

    const notMod = await handleRequest(
      makeReq({ headers: { ...clientAuth, 'if-none-match': 'W/"rev-0"' } }),
      deps,
    )
    expect(notMod.status).toBe(304)
    expect(await readBody(notMod)).toBe('')

    // PUT v1
    const put1 = await handleRequest(
      makeReq({
        method: 'PUT',
        path: '/schemas/finding',
        headers: adminAuth,
        body: {
          schema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      }),
      deps,
    )
    expect(put1.status).toBe(201)
    expect(put1.headers[SCHEMA_REVISION_HEADER]).toBe('1')
    expect(await readJson(put1)).toMatchObject({
      id: 'finding',
      version: 1,
      ref: 'finding@1',
      revision: 1,
      compatible: true,
      breakingChanges: [],
      createdBy: 'ops',
    })

    // PUT compatible v2 (adds optional property)
    const put2 = await handleRequest(
      makeReq({
        method: 'PUT',
        path: '/schemas/finding',
        headers: adminAuth,
        body: {
          schema: {
            type: 'object',
            properties: { title: { type: 'string' }, note: { type: 'string' } },
            required: ['title'],
          },
        },
      }),
      deps,
    )
    expect(put2.status).toBe(201)
    expect(await readJson(put2)).toMatchObject({
      version: 2,
      ref: 'finding@2',
      revision: 2,
      compatible: true,
    })

    // PUT breaking v3 rejected without breaking: true
    const breakingRefused = await handleRequest(
      makeReq({
        method: 'PUT',
        path: '/schemas/finding',
        headers: adminAuth,
        body: {
          schema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title', 'severity'],
          },
        },
      }),
      deps,
    )
    expect(breakingRefused.status).toBe(409)
    expect(await readJson(breakingRefused)).toMatchObject({
      code: 'breaking_change',
      compatible: false,
    })

    // PUT breaking v3 accepted with breaking: true
    const put3 = await handleRequest(
      makeReq({
        method: 'PUT',
        path: '/schemas/finding',
        headers: adminAuth,
        body: {
          schema: {
            type: 'object',
            properties: { title: { type: 'string' }, severity: { type: 'string' } },
            required: ['title', 'severity'],
          },
          breaking: true,
        },
      }),
      deps,
    )
    expect(put3.status).toBe(201)
    expect(await readJson(put3)).toMatchObject({ version: 3, revision: 3, compatible: false })

    // Bundle pull with include=versions
    const bundleRes = await handleRequest(
      makeReq({ query: { include: 'versions' }, headers: clientAuth }),
      deps,
    )
    expect(bundleRes.status).toBe(200)
    expect(bundleRes.headers.etag).toBe('"rev-3"')
    expect(await readJson(bundleRes)).toMatchObject({
      revision: 3,
      schemas: [{ id: 'finding', latestVersion: 3 }],
    })

    // GET latest, versions list, and pinned version
    const getLatest = await handleRequest(
      makeReq({ path: '/schemas/finding', headers: clientAuth }),
      deps,
    )
    expect(getLatest.status).toBe(200)
    expect(await readJson(getLatest)).toMatchObject({ id: 'finding', version: 3, ref: 'finding@3' })

    const getV1 = await handleRequest(
      makeReq({ path: '/schemas/finding/versions/1', headers: clientAuth }),
      deps,
    )
    expect(getV1.status).toBe(200)
    expect(await readJson(getV1)).toMatchObject({ id: 'finding', version: 1, ref: 'finding@1' })

    const getVersions = await handleRequest(
      makeReq({ path: '/schemas/finding/versions', headers: clientAuth }),
      deps,
    )
    expect(getVersions.status).toBe(200)
    expect(((await readJson(getVersions)).versions as unknown[]).length).toBe(3)

    // Revision header also appears on ordinary authenticated routes (e.g. sessions)
    const sessionsRes = await handleRequest(
      makeReq({ path: '/sessions', headers: clientAuth }),
      deps,
    )
    expect(sessionsRes.status).toBe(200)
    expect(sessionsRes.headers[SCHEMA_REVISION_HEADER]).toBe('3')
  })

  it('deprecates schemas without hard-deleting history and blocks subsequent puts', async () => {
    const { deps, adminAuth, clientAuth } = await setup()
    await handleRequest(
      makeReq({
        method: 'PUT',
        path: '/schemas/finding',
        headers: adminAuth,
        body: { schema: { type: 'object' } },
      }),
      deps,
    )

    const del = await handleRequest(
      makeReq({ method: 'DELETE', path: '/schemas/finding', headers: adminAuth }),
      deps,
    )
    expect(del.status).toBe(200)
    expect(await readJson(del)).toMatchObject({
      id: 'finding',
      deprecatedBy: 'ops',
      revision: 2,
    })

    // History still readable
    const getOld = await handleRequest(
      makeReq({ path: '/schemas/finding/versions/1', headers: clientAuth }),
      deps,
    )
    expect(getOld.status).toBe(200)

    // Further PUT rejected with 409
    const putAfter = await handleRequest(
      makeReq({
        method: 'PUT',
        path: '/schemas/finding',
        headers: adminAuth,
        body: { schema: { type: 'object' } },
      }),
      deps,
    )
    expect(putAfter.status).toBe(409)
    expect(await readJson(putAfter)).toMatchObject({ code: 'schema_deprecated' })

    // Deleting missing schema returns 404
    expect(
      (
        await handleRequest(
          makeReq({ method: 'DELETE', path: '/schemas/nope', headers: adminAuth }),
          deps,
        )
      ).status,
    ).toBe(404)
  })

  it('validates inputs, rejects bad drafts/refs/bodies, and propagates unexpected store errors', async () => {
    const { store, deps, adminAuth, clientAuth } = await setup()

    expect(
      (await handleRequest(makeReq({ query: { include: 'bogus' }, headers: clientAuth }), deps))
        .status,
    ).toBe(400)
    expect(
      (await handleRequest(makeReq({ path: '/schemas/missing', headers: clientAuth }), deps))
        .status,
    ).toBe(404)
    expect(
      (
        await handleRequest(
          makeReq({ path: '/schemas/missing/versions', headers: clientAuth }),
          deps,
        )
      ).status,
    ).toBe(404)
    expect(
      (await handleRequest(makeReq({ path: '/schemas/a/versions/0', headers: clientAuth }), deps))
        .status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          makeReq({ method: 'PUT', path: '/schemas/..bad', headers: adminAuth }),
          deps,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          makeReq({ method: 'PUT', path: '/schemas/a', headers: adminAuth, body: 'not-json' }),
          deps,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          makeReq({
            method: 'PUT',
            path: '/schemas/a',
            headers: adminAuth,
            body: 'x'.repeat(2 * 1024 * 1024),
          }),
          deps,
        )
      ).status,
    ).toBe(413)
    expect(
      (
        await handleRequest(
          makeReq({ method: 'PUT', path: '/schemas/a', headers: adminAuth, body: [] }),
          deps,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          makeReq({
            method: 'PUT',
            path: '/schemas/a',
            headers: adminAuth,
            body: { schema: { type: 'object' }, breaking: 'yes' },
          }),
          deps,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          makeReq({
            method: 'PUT',
            path: '/schemas/a',
            headers: adminAuth,
            body: { schema: { $schema: 'http://json-schema.org/draft-07/schema#' } },
          }),
          deps,
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await handleRequest(
          makeReq({
            method: 'PUT',
            path: '/schemas/a',
            headers: adminAuth,
            body: { schema: { type: 'object', properties: { x: { $ref: 'missing' } } } },
          }),
          deps,
        )
      ).status,
    ).toBe(400)

    // Store conflict retries cleanly up to MAX_PUT_ATTEMPTS, then maps to 409
    const putSpy = vi
      .spyOn(store, 'putSchemaVersion')
      .mockRejectedValueOnce(new SessionStoreError('schema_conflict', 'conflict-1'))
      .mockRejectedValueOnce(new SessionStoreError('schema_conflict', 'conflict-2'))
      .mockRejectedValueOnce(new SessionStoreError('schema_conflict', 'conflict-3'))
    expect(
      (
        await handleRequest(
          makeReq({
            method: 'PUT',
            path: '/schemas/a',
            headers: adminAuth,
            body: { schema: { type: 'object' } },
          }),
          deps,
        )
      ).status,
    ).toBe(409)
    expect(putSpy).toHaveBeenCalledTimes(3)

    // Direct expectedRevision mismatch in MemoryBlackboardStore throws schema_conflict
    await expect(
      store.putSchemaVersion({
        id: 'rev-check',
        schema: { type: 'object' },
        actor: 'ops',
        expectedVersion: 0,
        expectedRevision: 999,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    vi.spyOn(store, 'putSchemaVersion').mockRejectedValueOnce(new Error('unexpected-put'))
    await expect(
      handleRequest(
        makeReq({
          method: 'PUT',
          path: '/schemas/a',
          headers: adminAuth,
          body: { schema: { type: 'object' } },
        }),
        deps,
      ),
    ).rejects.toThrow('unexpected-put')

    vi.spyOn(store, 'deprecateSchema').mockRejectedValueOnce(new Error('unexpected-del'))
    await expect(
      handleRequest(makeReq({ method: 'DELETE', path: '/schemas/a', headers: adminAuth }), deps),
    ).rejects.toThrow('unexpected-del')
  })

  it('matches ETags with wildcard, lists, weak tags, and commas inside quoted tags', () => {
    expect(etagMatches(undefined, '"rev-1"')).toBe(false)
    expect(etagMatches('*', '"rev-1"')).toBe(true)
    expect(etagMatches('"rev-0", W/"rev-1"', '"rev-1"')).toBe(true)
    expect(etagMatches('"rev-0"', '"rev-1"')).toBe(false)
    expect(etagMatches('"old,*,tag"', '"rev-1"')).toBe(false)
  })
})
