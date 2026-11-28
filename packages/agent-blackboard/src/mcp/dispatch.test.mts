import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { dispatchTool } from './dispatch.mjs'

it('dispatches every entry/session/schema tool and rejects unknown names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abb-mcp-dispatch-'))
  const session = {
    id: 's',
    parentSessionId: null,
    agent: 'test',
    version: '1',
    createdAt: 'now',
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  const entry = { sessionId: 's', createdAt: 'now', data: {} }
  const bundle = {
    revision: 1,
    schemas: [
      {
        id: 'finding',
        latestVersion: 1,
        deprecatedAt: null,
        deprecatedBy: null,
        createdAt: 'now',
        createdBy: 'ops',
        updatedAt: 'now',
        updatedBy: 'ops',
        versions: [
          {
            id: 'finding',
            version: 1,
            ref: 'finding@1',
            schema: { type: 'object' },
            createdAt: 'now',
            createdBy: 'ops',
          },
        ],
      },
    ],
  }
  const fixture = await startHttpFixture((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (
      req.method === 'GET' &&
      url.pathname === '/schemas' &&
      url.searchParams.get('include') === 'versions'
    ) {
      return sendJson(res, 200, bundle)
    }
    if (req.method === 'GET' && url.pathname === '/schemas') {
      return sendJson(res, 200, { revision: 1, schemas: [] })
    }
    if (req.method === 'GET' && url.pathname === '/schemas/finding') {
      return sendJson(res, 200, { id: 'finding', version: 1, ref: 'finding@1', revision: 1 })
    }
    if (req.method === 'GET') {
      const isSessionsList = url.pathname === '/sessions'
      return sendJson(res, 200, isSessionsList ? { sessions: [entry], nextCursor: null } : [entry])
    }
    sendJson(res, 200, req.url.endsWith('/entries') ? entry : session)
  })
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    await expect(
      dispatchTool(
        'session_create',
        { sessionId: 's', parentSessionId: null, agent: 'test', version: '1' },
        config,
      ),
    ).resolves.toEqual(session)
    await expect(dispatchTool('session_archive', { sessionId: 's' }, config)).resolves.toEqual(
      session,
    )
    await expect(
      dispatchTool(
        'session_ensure',
        { sessionId: 's', parentSessionId: null, agent: 'test', version: '1' },
        config,
      ),
    ).resolves.toEqual({ status: 'created', session })
    await expect(
      dispatchTool('session_patch', { sessionId: 's', data: { branch: 'main' } }, config),
    ).resolves.toEqual(session)
    await expect(dispatchTool('session_search', {}, config)).resolves.toEqual({
      sessions: [entry],
      nextCursor: null,
    })
    await expect(
      dispatchTool('entry_append', { sessionId: 's', data: {} }, config),
    ).resolves.toEqual(entry)
    await expect(
      dispatchTool('entry_get', { sessionId: 's', format: 'json' }, config),
    ).resolves.toEqual({ entries: [entry] })
    await expect(dispatchTool('schema_list', {}, config)).resolves.toEqual({
      revision: 1,
      schemas: [],
    })
    await expect(dispatchTool('schema_get', { id: 'finding' }, config)).resolves.toMatchObject({
      ref: 'finding@1',
    })
    await expect(dispatchTool('schema_pull', { dir }, config)).resolves.toMatchObject({
      revision: 1,
      schemaCount: 1,
    })
    await expect(
      dispatchTool('schema_validate', { schema: 'finding', data: {}, dir }, config),
    ).resolves.toEqual({ valid: true, schema: 'finding@1', revision: 1, errors: [] })
    await expect(dispatchTool('outbox_status', { dir }, config)).resolves.toEqual({
      dir,
      pending: 0,
      rejected: 0,
      sessions: {},
      rejectedRecords: [],
    })
    await expect(dispatchTool('outbox_flush', { dir }, config)).resolves.toEqual({
      dir,
      delivered: 0,
      duplicates: 0,
      rejected: 0,
      remaining: 0,
    })
    await expect(dispatchTool('outbox_prune_rejected', { dir }, config)).resolves.toEqual({
      dir,
      removed: 0,
      remainingRejected: 0,
    })
    expect(() => dispatchTool('nope', {}, config)).toThrow('Unknown tool: nope')
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
