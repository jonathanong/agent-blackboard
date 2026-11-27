import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { Schemas } from './schemas.mjs'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'abb-client-schemas-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('Schemas client', () => {
  it('lists, gets, lists versions, pulls with If-None-Match, and validates locally', async () => {
    const dir = makeTempDir()
    const fixture = await startHttpFixture((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/schemas' && url.searchParams.get('include') === 'versions') {
        if (req.headers['if-none-match'] === '"rev-2"') {
          res.writeHead(304, { 'x-schema-registry-revision': '2' })
          res.end()
          return
        }
        return sendJson(res, 200, {
          revision: 2,
          schemas: [
            {
              id: 'finding',
              latestVersion: 1,
              deprecatedAt: null,
              deprecatedBy: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'ops',
              updatedAt: '2026-01-01T00:00:00.000Z',
              updatedBy: 'ops',
              versions: [
                {
                  id: 'finding',
                  version: 1,
                  ref: 'finding@1',
                  schema: {
                    type: 'object',
                    properties: { title: { type: 'string' } },
                    required: ['title'],
                  },
                  createdAt: '2026-01-01T00:00:00.000Z',
                  createdBy: 'ops',
                },
              ],
            },
          ],
        })
      }
      if (url.pathname === '/schemas') return sendJson(res, 200, { revision: 2, schemas: [] })
      if (url.pathname === '/schemas/finding') {
        return sendJson(res, 200, { id: 'finding', version: 1, ref: 'finding@1', revision: 2 })
      }
      if (url.pathname === '/schemas/finding/versions') {
        return sendJson(res, 200, { id: 'finding', versions: [], revision: 2 })
      }
      sendJson(res, 404, { error: 'not found' })
    })

    try {
      const schemas = new Schemas({ baseUrl: fixture.baseUrl, token: 't' })
      expect(await schemas.list()).toEqual({ revision: 2, schemas: [] })
      expect(await schemas.get('finding')).toMatchObject({ ref: 'finding@1' })
      expect(await schemas.listVersions('finding')).toEqual({
        id: 'finding',
        versions: [],
        revision: 2,
      })

      const pulled = await schemas.pull({ dir })
      expect(pulled).toEqual({
        upToDate: false,
        revision: 2,
        schemaCount: 1,
        versionCount: 1,
        dir,
      })

      const upToDate = await schemas.pull({ dir })
      expect(upToDate).toEqual({
        upToDate: true,
        revision: 2,
        schemaCount: 1,
        versionCount: 1,
        dir,
      })

      expect(schemas.validateLocal('finding', { title: 'ok' }, { dir })).toEqual({
        valid: true,
        schema: 'finding@1',
        revision: 2,
        errors: [],
      })

      rmSync(join(dir, 'versions', 'finding@1.json'))
      expect(await schemas.pull({ dir })).toEqual({
        upToDate: false,
        revision: 2,
        schemaCount: 1,
        versionCount: 1,
        dir,
      })

      // A delayed older-revision pull from the same source never downgrades a newer installed cache
      let delayedResolve: (() => void) | undefined
      let markFirstReceived: (() => void) | undefined
      const firstReceived = new Promise<void>((resolve) => {
        markFirstReceived = resolve
      })
      let pullCalls = 0
      const raceFixture = await startHttpFixture(async (req, res) => {
        pullCalls += 1
        if (pullCalls === 1) {
          markFirstReceived!()
          await new Promise<void>((resolve) => {
            delayedResolve = resolve
          })
          return sendJson(res, 200, { revision: 1, schemas: [] })
        }
        if (pullCalls === 3 && req.headers['if-none-match'] === '"rev-3"') {
          // Simulate local cache being wiped mid-flight before a 304 arrives
          rmSync(join(raceDir, 'manifest.json'), { force: true })
          res.writeHead(304, { 'x-schema-registry-revision': '3' })
          res.end()
          return
        }
        sendJson(res, 200, {
          revision: 3,
          schemas: [
            {
              id: 'finding',
              latestVersion: 1,
              deprecatedAt: null,
              deprecatedBy: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'ops',
              updatedAt: '2026-01-01T00:00:00.000Z',
              updatedBy: 'ops',
              versions: [
                {
                  id: 'finding',
                  version: 1,
                  ref: 'finding@1',
                  schema: { type: 'object' },
                  createdAt: '2026-01-01T00:00:00.000Z',
                  createdBy: 'ops',
                },
              ],
            },
          ],
        })
      })
      const raceDir = makeTempDir()
      try {
        const raceSchemas = new Schemas({ baseUrl: raceFixture.baseUrl, token: 't' })
        const slowOlder = raceSchemas.pull({ dir: raceDir })
        await firstReceived
        const fastNewer = await raceSchemas.pull({ dir: raceDir })
        expect(fastNewer).toEqual({
          upToDate: false,
          revision: 3,
          schemaCount: 1,
          versionCount: 1,
          dir: raceDir,
        })
        delayedResolve!()
        expect(await slowOlder).toEqual({
          upToDate: true,
          revision: 3,
          schemaCount: 1,
          versionCount: 1,
          dir: raceDir,
        })
        // If cache disappears mid-flight before a 304, pull repairs with an unconditional refetch
        expect(await raceSchemas.pull({ dir: raceDir })).toEqual({
          upToDate: false,
          revision: 3,
          schemaCount: 1,
          versionCount: 1,
          dir: raceDir,
        })
      } finally {
        await raceFixture.close()
      }

      // Pulling from a different server origin into the same dir ignores the previous ETag
      const otherFixture = await startHttpFixture((req, res) => {
        expect(req.headers['if-none-match']).toBeUndefined()
        sendJson(res, 200, { revision: 2, schemas: [] })
      })
      try {
        const otherSchemas = new Schemas({ baseUrl: otherFixture.baseUrl, token: 't' })
        expect(await otherSchemas.pull({ dir })).toEqual({
          upToDate: false,
          revision: 2,
          schemaCount: 0,
          versionCount: 0,
          dir,
        })
      } finally {
        await otherFixture.close()
      }

      await expect(schemas.listVersions('')).rejects.toThrow(TypeError)
    } finally {
      await fixture.close()
    }
  })

  it('handles 304 on pull when no local manifest exists and uses default options', async () => {
    const dir = makeTempDir()
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(304, { 'x-schema-registry-revision': '0' })
      res.end()
    })
    try {
      const schemas = new Schemas({ baseUrl: fixture.baseUrl, token: 't' })
      expect(
        await schemas.pull({ cwd: dir, env: { AGENT_BLACKBOARD_SCHEMAS_DIR: join(dir, 'empty') } }),
      ).toMatchObject({
        upToDate: true,
        revision: 0,
        schemaCount: 0,
        versionCount: 0,
      })
      mkdirSync(join(dir, '.git'))
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir)
      try {
        expect(() => schemas.validateLocal('finding', {})).toThrow(/schemas pull/)
      } finally {
        cwdSpy.mockRestore()
      }
    } finally {
      await fixture.close()
    }
  })
})
