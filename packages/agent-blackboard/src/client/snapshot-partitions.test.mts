import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Snapshots } from './snapshots.mjs'

const snapshotsToRemove = new Set<string>()

afterEach(async () => {
  await Promise.all([...snapshotsToRemove].map((path) => rm(path, { force: true })))
  snapshotsToRemove.clear()
})

function sourceRecords() {
  const sessions = ['one', 'two'].map((id, index) => ({
    id,
    parentSessionId: null,
    agent: 'agent',
    version: '1',
    createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }))
  const records = sessions.flatMap((session) => [
    { type: 'session', session },
    {
      type: 'entry',
      entry: { sessionId: session.id, createdAt: session.createdAt, data: { id: session.id } },
    },
  ])
  return [
    ...records,
    {
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
        selection: { archived: false },
        counts: { sessions: 2, entries: 2, records: 5 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    },
  ]
}

async function snapshot(records: unknown[] = sourceRecords()): Promise<string> {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o400,
  })
  snapshotsToRemove.add(path)
  return path
}

function withManifest(change: Record<string, unknown>): unknown[] {
  const records = structuredClone(sourceRecords()) as Array<Record<string, unknown>>
  const terminal = records.at(-1)!
  terminal.manifest = { ...(terminal.manifest as Record<string, unknown>), ...change }
  return records
}

it('partitions a generated snapshot by complete session and emits private terminal manifests', async () => {
  const path = await snapshot()
  const bytes = await readFile(path)
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  try {
    const result = await snapshots.partition({
      path,
      maxSessions: 1,
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(bytes).digest('hex') },
      counts: { sessions: 2, entries: 2, records: 5, bytes: bytes.byteLength },
    })
    expect(result.partitions).toHaveLength(2)
    expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
    for (const partition of result.partitions) {
      const lines = (await readFile(partition.path, 'utf8'))
        .trim()
        .split('\n')
        .map((source) => JSON.parse(source))
      expect(lines.at(-1).type).toBe('manifest')
      expect(lines.filter((line) => line.type === 'session')).toHaveLength(1)
      expect((await stat(partition.path)).mode & 0o777).toBe(0o400)
    }
    await snapshots.cleanup({ directory: result.directory })
    await expect(readdir(result.directory)).rejects.toThrow()
    await expect(snapshots.cleanup({ directory: result.directory })).resolves.toBeUndefined()
  } finally {
    await rm(path, { force: true })
  }
})

it('rejects user-chosen sources, invalid manifests, bad verification, and oversize sessions without residual partitions', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const outside = join(await mkdtemp(join(tmpdir(), 'snapshot-outside-')), 'snapshot.jsonl')
  await writeFile(outside, '{}')
  const invalid = await snapshot([{ type: 'session', session: { id: 'one' } }])
  const valid = await snapshot()
  try {
    await expect(snapshots.partition({ path: outside })).rejects.toThrow(
      'generated temporary snapshot',
    )
    await expect(snapshots.partition({ path: invalid })).rejects.toThrow(
      'complete terminal manifest',
    )
    await expect(
      snapshots.partition({ path: valid, checksum: { algorithm: 'sha256', value: 'wrong' } }),
    ).rejects.toThrow('checksum')
    await expect(snapshots.partition({ path: valid, maxBytes: 1 })).rejects.toThrow('too large')
    await expect(snapshots.cleanup({ directory: outside })).rejects.toThrow(
      'temporary partition directory',
    )
  } finally {
    await rm(outside, { force: true })
    await rm(invalid, { force: true })
    await rm(valid, { force: true })
  }
})

it('validates generated paths, record structure, limits, and cleanup targets', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const originalManifest = sourceRecords().at(-1) as { manifest: Record<string, unknown> }
  const valid = await snapshot()
  const malformed = await snapshot([{ type: 'entry', entry: { sessionId: 'one' } }])
  const afterManifest = await snapshot([
    ...sourceRecords(),
    { type: 'session', session: { id: 'three' } },
  ])
  const invalidJson = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(invalidJson, '{invalid\n', { mode: 0o400 })
  await chmod(invalidJson, 0o400)
  const empty = await snapshot([
    {
      type: 'manifest',
      manifest: {
        ...originalManifest.manifest,
        counts: { sessions: 0, entries: 0, records: 1 },
      },
    },
  ])
  const notDirectory = join(
    tmpdir(),
    `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`,
  )
  await writeFile(notDirectory, 'not a directory')
  try {
    await expect(snapshots.partition({ path: 'relative' })).rejects.toThrow('absolute')
    await expect(snapshots.partition({ path: malformed })).rejects.toThrow('unsupported record')
    await expect(snapshots.partition({ path: afterManifest })).rejects.toThrow('after its manifest')
    await expect(snapshots.partition({ path: invalidJson })).rejects.toThrow('invalid JSONL')
    const mismatched = structuredClone(sourceRecords()) as Array<Record<string, unknown>>
    ;(mismatched[1]!.entry as Record<string, unknown>).sessionId = 'other'
    await expect(snapshots.partition({ path: await snapshot(mismatched) })).rejects.toThrow(
      'entries must follow',
    )
    for (const change of [
      { schemaVersion: 2 },
      { status: 'incomplete' },
      { ordering: { sessions: 'wrong', entries: 'createdAt ascending within session' } },
      { ordering: { sessions: 'createdAt ascending', entries: 'wrong' } },
      { consistency: 'wrong' },
    ]) {
      await expect(
        snapshots.partition({ path: await snapshot(withManifest(change)) }),
      ).rejects.toThrow('complete terminal manifest')
    }
    await expect(
      snapshots.partition({
        path: await snapshot(withManifest({ counts: { sessions: 1, entries: 2, records: 5 } })),
      }),
    ).rejects.toThrow('counts do not match')
    await expect(
      snapshots.partition({
        path: valid,
        counts: { sessions: 1, entries: 2, records: 5, bytes: 1 },
      }),
    ).rejects.toThrow('snapshot counts do not match')
    await expect(snapshots.partition({ path: valid, maxSessions: 0 })).rejects.toThrow(
      'maxSessions',
    )
    await expect(snapshots.partition({ path: valid, maxBytes: 0 })).rejects.toThrow('maxBytes')
    const single = await snapshots.partition({ path: valid, maxSessions: 1 })
    await snapshots.cleanup({ directory: single.directory })
    const byBytes = await snapshots.partition({
      path: valid,
      maxBytes: single.partitions[0]!.counts.bytes,
    })
    expect(byBytes.partitions).toHaveLength(2)
    await snapshots.cleanup({ directory: byBytes.directory })
    const noSessions = await snapshots.partition({ path: empty })
    expect(noSessions.partitions).toEqual([])
    await snapshots.cleanup({ directory: noSessions.directory })
    const large = structuredClone(sourceRecords()) as Array<Record<string, unknown>>
    ;(large[2]!.session as Record<string, unknown>).data = { payload: 'x'.repeat(2048) }
    const largePath = await snapshot(large)
    const smallFirst = await snapshots.partition({ path: largePath, maxSessions: 1 })
    await expect(
      snapshots.partition({ path: largePath, maxBytes: smallFirst.partitions[0]!.counts.bytes }),
    ).rejects.toThrow('too large')
    await snapshots.cleanup({ directory: smallFirst.directory })
    await rm(largePath, { force: true })
    await expect(snapshots.cleanup({ directory: notDirectory })).rejects.toThrow('not a directory')
    await expect(snapshots.cleanup({ directory: 'relative' })).rejects.toThrow(
      'generated temporary',
    )
  } finally {
    await rm(valid, { force: true })
    await rm(malformed, { force: true })
    await rm(afterManifest, { force: true })
    await rm(invalidJson, { force: true })
    await rm(empty, { force: true })
    await rm(notDirectory, { force: true })
  }
})
