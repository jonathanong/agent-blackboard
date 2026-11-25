import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import {
  handleSchemaGet,
  handleSchemaList,
  handleSchemaPull,
  handleSchemaValidate,
} from './tool-schemas.mjs'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'abb-mcp-schemas-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('MCP schema tools', () => {
  it('supports schema_list, schema_get, schema_pull, and offline schema_validate', async () => {
    const dir = makeTempDir()
    const cacheDir = join(dir, 'cache')
    const fixture = await startHttpFixture((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/schemas' && url.searchParams.get('include') === 'versions') {
        return sendJson(res, 200, {
          revision: 1,
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
      if (url.pathname === '/schemas') return sendJson(res, 200, { revision: 1, schemas: [] })
      if (url.pathname === '/schemas/finding/versions/1') {
        return sendJson(res, 200, { id: 'finding', version: 1, ref: 'finding@1', revision: 1 })
      }
      sendJson(res, 404, { error: 'not found' })
    })

    try {
      const config = { baseUrl: fixture.baseUrl, token: 't' }
      expect(await handleSchemaList(config)).toEqual({ revision: 1, schemas: [] })
      expect(await handleSchemaGet({ id: 'finding', version: 1 }, config)).toMatchObject({
        ref: 'finding@1',
      })

      const pulled = await handleSchemaPull({ dir: cacheDir }, config, { cwd: dir, env: {} })
      expect(pulled).toMatchObject({ upToDate: false, revision: 1, schemaCount: 1 })

      const valid = await handleSchemaValidate(
        { schema: 'finding', data: { title: 'hello' } },
        config,
        { cwd: dir, env: { AGENT_BLACKBOARD_SCHEMAS_DIR: cacheDir } },
      )
      expect(valid).toEqual({ valid: true, schema: 'finding@1', revision: 1, errors: [] })

      const invalid = await handleSchemaValidate(
        { schema: 'finding@1', data: { title: 42 }, dir: cacheDir },
        config,
      )
      expect(invalid.valid).toBe(false)
      expect(invalid.errors.length).toBeGreaterThan(0)
    } finally {
      await fixture.close()
    }
  })
})
