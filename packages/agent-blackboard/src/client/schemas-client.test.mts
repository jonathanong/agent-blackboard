import { describe, expect, it, vi } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import {
  deprecateSchemaRequest,
  fetchSchemaBundleRequest,
  getSchemaRequest,
  listSchemasRequest,
  putSchemaRequest,
} from './schemas-client.mjs'

describe('schemas HTTP client', () => {
  it('supports list, get, get pinned, conditional pull (200 & 304), put, delete, and revision callback', async () => {
    const seenRevisions: number[] = []
    const fixture = await startHttpFixture((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      res.setHeader('x-schema-registry-revision', '5')
      if (
        req.method === 'GET' &&
        url.pathname === '/schemas' &&
        url.searchParams.get('include') === 'versions'
      ) {
        if (req.headers['if-none-match'] === '"rev-5"') {
          res.writeHead(304, { 'x-schema-registry-revision': '5', etag: '"rev-5"' })
          res.end()
          return
        }
        return sendJson(res, 200, { revision: 5, schemas: [] })
      }
      if (req.method === 'GET' && url.pathname === '/schemas') {
        return sendJson(res, 200, { revision: 5, schemas: [] })
      }
      if (req.method === 'GET' && url.pathname === '/schemas/finding') {
        return sendJson(res, 200, { id: 'finding', version: 2, ref: 'finding@2', revision: 5 })
      }
      if (req.method === 'GET' && url.pathname === '/schemas/finding/versions/1') {
        return sendJson(res, 200, { id: 'finding', version: 1, ref: 'finding@1', revision: 5 })
      }
      if (req.method === 'PUT' && url.pathname === '/schemas/finding') {
        return sendJson(res, 201, { id: 'finding', version: 3, ref: 'finding@3', revision: 6 })
      }
      if (req.method === 'DELETE' && url.pathname === '/schemas/finding') {
        return sendJson(res, 200, { id: 'finding', deprecatedAt: 'now', revision: 7 })
      }
      sendJson(res, 404, { error: 'not found' })
    })

    try {
      const config = {
        baseUrl: fixture.baseUrl,
        token: 'abb_sk_x_y',
        onSchemaRevision: vi.fn((rev: number) => {
          seenRevisions.push(rev)
        }),
      }
      expect(await listSchemasRequest(config)).toEqual({ revision: 5, schemas: [] })
      expect(await getSchemaRequest(config, 'finding')).toMatchObject({ version: 2 })
      expect(await getSchemaRequest(config, 'finding', 1)).toMatchObject({ version: 1 })
      expect(await fetchSchemaBundleRequest(config)).toEqual({
        notModified: false,
        bundle: { revision: 5, schemas: [] },
      })
      expect(await fetchSchemaBundleRequest(config, 5)).toEqual({ notModified: true, revision: 5 })
      expect(
        await putSchemaRequest(config, 'finding', { schema: { type: 'object' } }),
      ).toMatchObject({
        version: 3,
      })
      expect(await deprecateSchemaRequest(config, 'finding')).toMatchObject({ id: 'finding' })
      await expect(getSchemaRequest(config, '')).rejects.toThrow(TypeError)
      await expect(putSchemaRequest(config, '../bad', { schema: {} })).rejects.toThrow(TypeError)
      await expect(deprecateSchemaRequest(config, 'constructor')).rejects.toThrow(TypeError)
      expect(seenRevisions.length).toBeGreaterThanOrEqual(7)
    } finally {
      await fixture.close()
    }
  })

  it('falls back to requested revision when 304 omits revision header', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(304)
      res.end()
    })
    try {
      const config = { baseUrl: fixture.baseUrl, token: 't' }
      expect(await fetchSchemaBundleRequest(config, 3)).toEqual({ notModified: true, revision: 3 })
      expect(await fetchSchemaBundleRequest(config)).toEqual({ notModified: true, revision: 0 })
    } finally {
      await fixture.close()
    }
  })
})
