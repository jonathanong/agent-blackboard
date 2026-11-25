import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { CliError } from './errors.mjs'
import { runCli } from './index.mjs'
import { runSchemas } from './schemas.mjs'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'abb-cli-schemas-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('CLI schemas subcommands and revision sync notice', () => {
  it('pulls, skips unchanged 304, validates offline, puts, removes, lists, and gets schemas', async () => {
    const dir = makeTempDir()
    const cacheDir = join(dir, 'cache')
    const schemaFile = join(dir, 'finding.schema.json')
    const validEntryFile = join(dir, 'valid.json')
    const invalidEntryFile = join(dir, 'invalid.json')
    const badJsonFile = join(dir, 'bad.json')
    const arrayJsonFile = join(dir, 'arr.json')

    writeFileSync(
      schemaFile,
      JSON.stringify({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      }),
    )
    writeFileSync(validEntryFile, JSON.stringify({ title: 'ok' }))
    writeFileSync(invalidEntryFile, JSON.stringify({ title: 42 }))
    writeFileSync(badJsonFile, '{not json')
    writeFileSync(arrayJsonFile, '[]')

    let serverRevision = 2
    const fixture = await startHttpFixture((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      res.setHeader('x-schema-registry-revision', String(serverRevision))
      if (
        req.method === 'GET' &&
        url.pathname === '/schemas' &&
        url.searchParams.get('include') === 'versions'
      ) {
        if (req.headers['if-none-match'] === `"rev-${serverRevision}"`) {
          res.writeHead(304, { 'x-schema-registry-revision': String(serverRevision) })
          res.end()
          return
        }
        return sendJson(res, 200, {
          revision: serverRevision,
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
      if (req.method === 'GET' && url.pathname === '/schemas') {
        return sendJson(res, 200, { revision: serverRevision, schemas: [] })
      }
      if (req.method === 'GET' && url.pathname === '/schemas/finding') {
        return sendJson(res, 200, {
          id: 'finding',
          version: 1,
          ref: 'finding@1',
          revision: serverRevision,
        })
      }
      if (req.method === 'GET' && url.pathname === '/schemas/finding/versions/1') {
        return sendJson(res, 200, {
          id: 'finding',
          version: 1,
          ref: 'finding@1',
          revision: serverRevision,
        })
      }
      if (req.method === 'PUT' && url.pathname === '/schemas/finding') {
        serverRevision += 1
        return sendJson(res, 201, {
          id: 'finding',
          version: 2,
          ref: 'finding@2',
          revision: serverRevision,
          compatible: true,
          breakingChanges: [],
        })
      }
      if (req.method === 'DELETE' && url.pathname === '/schemas/finding') {
        serverRevision += 1
        return sendJson(res, 200, { id: 'finding', deprecatedAt: 'now', revision: serverRevision })
      }
      if (req.method === 'POST' && url.pathname === '/schemas/finding/versions/2/promote') {
        serverRevision += 1
        return sendJson(res, 200, {
          id: 'finding',
          version: 2,
          ref: 'finding@2',
          mode: 'enforced',
          alreadyEnforced: false,
          revision: serverRevision,
        })
      }
      if (req.method === 'GET' && url.pathname === '/schemas/finding/report') {
        return sendJson(res, 200, {
          id: 'finding',
          version: null,
          totalFailures: 1,
          versions: [],
          recentFailures: [],
          revision: serverRevision,
        })
      }
      if (req.method === 'GET' && url.pathname === '/schemas/finding/versions/2/report') {
        return sendJson(res, 200, {
          id: 'finding',
          version: 2,
          totalFailures: 1,
          versions: [],
          recentFailures: [],
          revision: serverRevision,
        })
      }
      sendJson(res, 200, { sessions: [], nextCursor: null })
    })

    try {
      const env = {
        AGENT_BLACKBOARD_URL: fixture.baseUrl,
        AGENT_BLACKBOARD_TOKEN: 'abb_sk_x_y',
        AGENT_BLACKBOARD_ADMIN_TOKEN: 'abb_admin_ops_secret',
        AGENT_BLACKBOARD_SCHEMAS_DIR: cacheDir,
      }

      // Before pulling, an ordinary command prints one out-of-date line on stderr
      const staleList = createFakeContext({ env, cwd: dir })
      expect(await runCli(['sessions', 'list'], staleList)).toBe(0)
      expect(staleList.stderrLines.join('')).toContain('agent-blackboard schemas pull')

      // Pull writes local copy without printing stale warning
      const pull1 = createFakeContext({ env, cwd: dir })
      await runSchemas(['pull'], pull1)
      expect(JSON.parse(pull1.stdoutLines[0]!)).toMatchObject({
        upToDate: false,
        revision: 2,
        schemaCount: 1,
        versionCount: 1,
      })
      expect(pull1.stderrLines).toEqual([])

      // Second pull gets 304 Not Modified
      const pull2 = createFakeContext({ env, cwd: dir })
      await runSchemas(['pull'], pull2)
      expect(JSON.parse(pull2.stdoutLines[0]!)).toMatchObject({
        upToDate: true,
        revision: 2,
        schemaCount: 1,
        versionCount: 1,
      })

      // After pull, ordinary command is quiet on stderr
      const freshList = createFakeContext({ env, cwd: dir })
      await runSchemas(['list'], freshList)
      expect(freshList.stderrLines).toEqual([])

      // Offline validate passes & fails cleanly without needing network/tokens
      const valOk = createFakeContext({ env: { AGENT_BLACKBOARD_SCHEMAS_DIR: cacheDir }, cwd: dir })
      await runSchemas(['validate', 'finding', validEntryFile], valOk)
      expect(JSON.parse(valOk.stdoutLines[0]!)).toMatchObject({ valid: true, schema: 'finding@1' })

      const valBad = createFakeContext({ env: {}, cwd: dir })
      await expect(
        runSchemas(['validate', 'finding@1', invalidEntryFile, '--dir', cacheDir], valBad),
      ).rejects.toThrow(CliError)
      expect(JSON.parse(valBad.stdoutLines[0]!)).toMatchObject({ valid: false })

      // Get latest and pinned
      const getLatest = createFakeContext({ env, cwd: dir })
      await runSchemas(['get', 'finding'], getLatest)
      expect(JSON.parse(getLatest.stdoutLines[0]!)).toMatchObject({ ref: 'finding@1' })

      const getPinned = createFakeContext({ env, cwd: dir })
      await runSchemas(['get', 'finding@1'], getPinned)
      expect(JSON.parse(getPinned.stdoutLines[0]!)).toMatchObject({ ref: 'finding@1' })

      // Admin put (with and without --breaking) and remove
      const putCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['put', 'finding', schemaFile], putCtx)
      expect(JSON.parse(putCtx.stdoutLines[0]!)).toMatchObject({ ref: 'finding@2' })

      const putBreakingCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['put', 'finding', schemaFile, '--breaking=true'], putBreakingCtx)
      const putReq = fixture.requests.at(-1)!
      expect(JSON.parse(putReq.body)).toMatchObject({ breaking: true })

      const putFalseBreakingCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['put', 'finding', schemaFile, '--breaking=false'], putFalseBreakingCtx)
      expect(JSON.parse(fixture.requests.at(-1)!.body)).not.toHaveProperty('breaking')

      const putShadowCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['put', 'finding', schemaFile, '--shadow'], putShadowCtx)
      expect(JSON.parse(fixture.requests.at(-1)!.body)).toMatchObject({ shadow: true })

      const promoteCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['promote', 'finding@2'], promoteCtx)
      expect(JSON.parse(promoteCtx.stdoutLines[0]!)).toMatchObject({
        ref: 'finding@2',
        mode: 'enforced',
      })

      const reportAllCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['report', 'finding'], reportAllCtx)
      expect(JSON.parse(reportAllCtx.stdoutLines[0]!)).toMatchObject({
        id: 'finding',
        version: null,
        totalFailures: 1,
      })

      const reportV2Ctx = createFakeContext({ env, cwd: dir })
      await runSchemas(['report', 'finding@2', '--limit', '10'], reportV2Ctx)
      expect(fixture.requests.at(-1)!.url).toBe('/schemas/finding/versions/2/report?limit=10')
      expect(JSON.parse(reportV2Ctx.stdoutLines[0]!)).toMatchObject({
        id: 'finding',
        version: 2,
        totalFailures: 1,
      })

      const removeCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['remove', 'finding'], removeCtx)
      expect(JSON.parse(removeCtx.stdoutLines[0]!)).toMatchObject({ id: 'finding' })
      // Server revision advanced past local rev 2 -> one stderr notice emitted
      expect(removeCtx.stderrLines.length).toBe(1)

      // Error handling for bad args and files
      const emptyCtx = createFakeContext({ env, cwd: dir })
      await expect(runSchemas([], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['bogus'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['pull', '--dir'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['put', 'finding'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['put', 'bad/id', schemaFile], emptyCtx)).rejects.toThrow(CliError)
      await expect(
        runSchemas(['put', 'finding', schemaFile, '--breaking=maybe'], emptyCtx),
      ).rejects.toThrow(CliError)
      await expect(
        runSchemas(['put', 'finding', join(dir, 'missing.json')], emptyCtx),
      ).rejects.toThrow(CliError)
      await expect(runSchemas(['put', 'finding', badJsonFile], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['put', 'finding', arrayJsonFile], emptyCtx)).rejects.toThrow(
        CliError,
      )
      await expect(runSchemas(['remove'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['remove', 'bad/id'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['get'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['get', 'bad/id'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['validate', 'finding'], emptyCtx)).rejects.toThrow(CliError)
      await expect(
        runSchemas(['validate', 'finding', validEntryFile, '--dir'], emptyCtx),
      ).rejects.toThrow(CliError)
      await expect(
        runSchemas(['validate', 'finding', arrayJsonFile, '--dir', cacheDir], emptyCtx),
      ).rejects.toThrow(CliError)
      await expect(
        runSchemas(['put', 'finding', schemaFile, '--shadow=nope'], emptyCtx),
      ).rejects.toThrow(CliError)
      await expect(runSchemas(['promote'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['promote', 'finding'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['promote', 'bad/id@1'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['report'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['report', 'bad/id'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['report', 'finding', '--limit'], emptyCtx)).rejects.toThrow(CliError)
      await expect(runSchemas(['report', 'finding', '--limit', '0'], emptyCtx)).rejects.toThrow(
        CliError,
      )
      await expect(runSchemas(['report', 'finding', '--limit', '101'], emptyCtx)).rejects.toThrow(
        CliError,
      )
    } finally {
      await fixture.close()
    }
  })

  it('handles 304 when no local manifest existed and suppresses revision 0 notices', async () => {
    const dir = makeTempDir()
    const fixture = await startHttpFixture((req, res) => {
      if (req.url.includes('include=versions')) {
        res.writeHead(304, { 'x-schema-registry-revision': '0' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-schema-registry-revision': '0' })
      res.end(JSON.stringify({ revision: 0, schemas: [] }))
    })
    try {
      const env = {
        AGENT_BLACKBOARD_URL: fixture.baseUrl,
        AGENT_BLACKBOARD_TOKEN: 't',
        AGENT_BLACKBOARD_SCHEMAS_DIR: join(dir, 'empty'),
      }
      const pullCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['pull'], pullCtx)
      expect(JSON.parse(pullCtx.stdoutLines[0]!)).toMatchObject({
        upToDate: true,
        revision: 0,
        schemaCount: 0,
        versionCount: 0,
      })

      const listCtx = createFakeContext({ env, cwd: dir })
      await runSchemas(['list'], listCtx)
      expect(listCtx.stderrLines).toEqual([])
    } finally {
      await fixture.close()
    }
  })
})
