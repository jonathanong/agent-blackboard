import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { dispatchTool } from './dispatch.mjs'

it('exports compact snapshot metadata without exposing JSONL through MCP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-mcp-snapshot-'))
  const fixture = await startHttpFixture((_request, response) =>
    sendNdjson(response, [
      {
        type: 'session',
        session: {
          id: 's',
          parentSessionId: null,
          agent: 'a',
          version: '1',
          createdAt: 'now',
          lastEntryAt: null,
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'manifest',
        manifest: {
          schemaVersion: 1,
          status: 'complete',
          createdAt: 'now',
          completedAt: 'now',
          selection: {
            archived: false,
            agent: 'a',
            version: '1',
            parentSessionId: null,
            data: { branch: 'main' },
            inactiveForHours: 1,
          },
          counts: { sessions: 1, entries: 0, records: 2 },
          ordering: {
            sessions: 'createdAt ascending',
            entries: 'createdAt ascending within session',
          },
          consistency: 'best-effort',
        },
      },
    ]),
  )
  try {
    const result = await dispatchTool(
      'snapshot_export',
      {
        path: join(directory, 'snapshot.jsonl'),
        agent: 'a',
        version: '1',
        parentSessionId: null,
        data: { branch: 'main' },
        inactiveForHours: 1,
      },
      { baseUrl: fixture.baseUrl, token: 't' },
    )
    expect(result).toMatchObject({
      path: join(directory, 'snapshot.jsonl'),
      counts: { sessions: 1 },
    })
    expect(
      new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('parentSessionId'),
    ).toBe('')
    expect(() =>
      dispatchTool('snapshot_export', { path: 1 }, { baseUrl: fixture.baseUrl, token: 't' }),
    ).toThrow('path')
    expect(() =>
      dispatchTool('snapshot_export', { data: [] }, { baseUrl: fixture.baseUrl, token: 't' }),
    ).toThrow('data')
    expect(() =>
      dispatchTool(
        'snapshot_export',
        { parentSessionId: 'invalid/id' },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toThrow('parentSessionId')
  } finally {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})
