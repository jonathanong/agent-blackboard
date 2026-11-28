import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import type { SnapshotExportResult, SnapshotPartitionResult } from '../client/snapshot-types.mjs'
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
            dataArrayContains: { repositories: 'owner/repo' },
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
        dataArrayContains: { repositories: 'owner/repo' },
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
        { dataArrayContains: { repositories: '' } },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toThrow('string values')
    expect(() =>
      dispatchTool(
        'snapshot_export',
        { dataArrayContains: {} },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toThrow('string values')
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

it('exports with cleanupToken, partitions, and cleans up both artifacts over MCP', async () => {
  const fixture = await startHttpFixture((_request, response) =>
    sendNdjson(response, [
      {
        type: 'session',
        session: {
          id: 's1',
          parentSessionId: null,
          agent: 'codex',
          version: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastEntryAt: '2026-01-01T00:01:00.000Z',
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'entry',
        entry: {
          sessionId: 's1',
          createdAt: '2026-01-01T00:01:00.000Z',
          data: { note: 'one' },
        },
      },
      {
        type: 'session',
        session: {
          id: 's2',
          parentSessionId: null,
          agent: 'codex',
          version: '1',
          createdAt: '2026-01-01T00:02:00.000Z',
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
          createdAt: '2026-01-01T00:03:00.000Z',
          completedAt: '2026-01-01T00:03:00.000Z',
          selection: { archived: false },
          counts: { sessions: 2, entries: 1, records: 4 },
          ordering: {
            sessions: 'createdAt ascending',
            entries: 'createdAt ascending within session',
          },
          consistency: 'best-effort',
        },
      },
    ]),
  )
  const config = { baseUrl: fixture.baseUrl, token: 't' }
  let exportedPath: string | undefined
  const partitionDirs: string[] = []
  try {
    const exported = (await dispatchTool('snapshot_export', {}, config)) as SnapshotExportResult
    exportedPath = exported.path
    expect(typeof exported.cleanupToken).toBe('string')
    expect(exported.cleanupToken!.length).toBeGreaterThan(0)

    // Wrong token fails ownership checks
    await expect(
      dispatchTool(
        'snapshot_partition',
        { path: exported.path, cleanupToken: 'wrong-token' },
        config,
      ),
    ).rejects.toThrow(Error)

    const partitioned = (await dispatchTool(
      'snapshot_partition',
      {
        path: exported.path,
        cleanupToken: exported.cleanupToken,
        maxSessions: 1,
        maxBytes: 1024 * 1024,
        checksum: exported.checksum.value,
        counts: exported.counts,
      },
      config,
    )) as SnapshotPartitionResult
    partitionDirs.push(partitioned.directory)
    expect(partitioned.partitions).toHaveLength(2)
    expect(partitioned.cleanupToken).toBe(exported.cleanupToken)

    // Default partition options (omitting optional fields)
    const partitionedDefault = (await dispatchTool(
      'snapshot_partition',
      { path: exported.path, cleanupToken: exported.cleanupToken },
      config,
    )) as SnapshotPartitionResult
    partitionDirs.push(partitionedDefault.directory)
    expect(partitionedDefault.partitions).toHaveLength(1)

    // Clean up both the snapshot and both partition directories
    await expect(
      dispatchTool(
        'snapshot_cleanup',
        { directory: partitionedDefault.directory, cleanupToken: exported.cleanupToken },
        config,
      ),
    ).resolves.toEqual({ removed: true })
    await expect(
      dispatchTool(
        'snapshot_cleanup',
        {
          path: exported.path,
          directory: partitioned.directory,
          cleanupToken: exported.cleanupToken,
        },
        config,
      ),
    ).resolves.toEqual({ removed: true })

    await expect(access(exported.path)).rejects.toThrow()
    await expect(access(partitioned.directory)).rejects.toThrow()
  } finally {
    await fixture.close()
    for (const dir of partitionDirs) await rm(dir, { recursive: true, force: true })
    if (exportedPath) await rm(exportedPath, { force: true })
  }
})

it('validates snapshot_partition and snapshot_cleanup arguments', async () => {
  const config = { baseUrl: 'http://localhost:1', token: 't' }
  expect(() =>
    dispatchTool(
      'snapshot_partition',
      { path: '/tmp/example.jsonl', cleanupToken: 'tok', checksum: 'not-sha256' },
      config,
    ),
  ).toThrow(Error)
  expect(() =>
    dispatchTool(
      'snapshot_partition',
      {
        path: '/tmp/example.jsonl',
        cleanupToken: 'tok',
        counts: { sessions: -1, entries: 0, records: 0, bytes: 0 },
      },
      config,
    ),
  ).toThrow(Error)
  await expect(dispatchTool('snapshot_cleanup', { cleanupToken: 'tok' }, config)).rejects.toThrow(
    Error,
  )
})
