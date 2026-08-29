import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runSnapshot } from './snapshot.mjs'

const records = [
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
        parentSessionId: null,
        agent: 'a',
        version: '1',
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
]

it('exports a filtered root-only snapshot and emits only its compact result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'abb-cli-snapshot-'))
  const fixture = await startHttpFixture((_request, response) => sendNdjson(response, records))
  try {
    const ctx = createFakeContext({
      env: { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' },
    })
    await runSnapshot(
      [
        'export',
        '--path',
        join(directory, 'snapshot.jsonl'),
        '--root-only',
        '--agent',
        'a',
        '--version',
        '1',
        '--data',
        '{"branch":"main"}',
        '--inactive-for-hours',
        '1',
      ],
      ctx,
    )
    expect(JSON.parse(ctx.stdoutLines[0]!)).toMatchObject({
      path: join(directory, 'snapshot.jsonl'),
    })
    const request = new URL(fixture.requests[0]!.url, fixture.baseUrl)
    expect(request.searchParams.get('parentSessionId')).toBe('')
    expect(request.searchParams.get('agent')).toBe('a')
  } finally {
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects invalid snapshot command arguments before making an HTTP request', async () => {
  const ctx = createFakeContext({ env: {} })
  await expect(runSnapshot(['nope'], ctx)).rejects.toThrow('requires: export')
  await expect(runSnapshot(['export'], ctx)).rejects.toThrow('AGENT_BLACKBOARD_URL')
  await expect(
    runSnapshot(['export', '--root-only', '--parent-session-id', 'p'], ctx),
  ).rejects.toThrow('cannot be combined')
  await expect(runSnapshot(['export', '--data', '[]'], ctx)).rejects.toThrow('JSON object')
  await expect(runSnapshot(['export', '--agent'], ctx)).rejects.toThrow('requires a value')
  await expect(runSnapshot(['export', 'extra'], ctx)).rejects.toThrow('accepts flags only')
  await expect(runSnapshot(['export', '--parent-session-id', 'invalid/id'], ctx)).rejects.toThrow(
    'parent-session-id is invalid',
  )
  await expect(runSnapshot(['export', '--inactive-for-hours', '0'], ctx)).rejects.toThrow(
    'positive number',
  )
  await expect(runSnapshot(['export', '--inactive-for-hours', 'NaN'], ctx)).rejects.toThrow(
    'positive number',
  )
})

it('exports a snapshot without optional filters or an explicit path', async () => {
  const fixture = await startHttpFixture((_request, response) =>
    sendNdjson(response, [
      records[0],
      {
        type: 'manifest',
        manifest: {
          ...records[1]!.manifest,
          selection: { archived: false, parentSessionId: 'parent' },
        },
      },
    ]),
  )
  const ctx = createFakeContext({
    env: { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' },
  })
  try {
    await runSnapshot(['export', '--parent-session-id', 'parent'], ctx)
    const result = JSON.parse(ctx.stdoutLines[0]!) as { path: string }
    expect(result.path).toContain('agent-blackboard-snapshot-')
    await rm(result.path, { force: true })
  } finally {
    await fixture.close()
  }
})

it('partitions and cleans up only generated temporary snapshots without server credentials', async () => {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o400,
  })
  await chmod(path, 0o400)
  const bytes = await readFile(path)
  const ctx = createFakeContext({ env: {} })
  try {
    await runSnapshot(
      [
        'partition',
        '--path',
        path,
        '--max-sessions',
        '1',
        '--checksum',
        createHash('sha256').update(bytes).digest('hex'),
        '--sessions',
        '1',
        '--entries',
        '0',
        '--records',
        '2',
        '--bytes',
        String(bytes.byteLength),
      ],
      ctx,
    )
    const result = JSON.parse(ctx.stdoutLines[0]!) as { directory: string; partitions: unknown[] }
    expect(result.partitions).toHaveLength(1)
    await runSnapshot(['cleanup', '--directory', result.directory], ctx)
    const defaults = createFakeContext({ env: {} })
    await runSnapshot(['partition', '--path', path, '--max-bytes', '10000'], defaults)
    const defaultResult = JSON.parse(defaults.stdoutLines[0]!) as { directory: string }
    await runSnapshot(['cleanup', '--directory', defaultResult.directory], defaults)
    await expect(
      runSnapshot(['partition', '--path', path, '--max-bytes', 'no'], ctx),
    ).rejects.toThrow('positive integer')
  } finally {
    await rm(path, { force: true })
  }
})

it('validates partition and cleanup arguments before operating on the filesystem', async () => {
  const ctx = createFakeContext({ env: {} })
  await expect(runSnapshot(['partition'], ctx)).rejects.toThrow('requires --path')
  await expect(runSnapshot(['partition', 'extra', '--path', '/tmp/a'], ctx)).rejects.toThrow(
    'accepts flags only',
  )
  await expect(
    runSnapshot(['partition', '--path', '/tmp/a', '--checksum', 'bad'], ctx),
  ).rejects.toThrow('SHA-256')
  await expect(
    runSnapshot(['partition', '--path', '/tmp/a', '--sessions', '1'], ctx),
  ).rejects.toThrow('count verification')
  await expect(
    runSnapshot(['partition', '--path', '/tmp/a', '--entries', '-1'], ctx),
  ).rejects.toThrow('non-negative integer')
  await expect(runSnapshot(['cleanup'], ctx)).rejects.toThrow('requires --directory')
  await expect(runSnapshot(['cleanup', 'extra', '--directory', '/tmp/a'], ctx)).rejects.toThrow(
    'accepts flags only',
  )
})
