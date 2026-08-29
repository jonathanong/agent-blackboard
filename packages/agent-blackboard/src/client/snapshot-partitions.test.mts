import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  chmod,
  link,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
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

async function partitionArtifacts(): Promise<string[]> {
  return (await readdir(tmpdir()))
    .filter(
      (name) =>
        name.startsWith('agent-blackboard-partition-stage-') ||
        name.startsWith('agent-blackboard-partitions-'),
    )
    .sort()
}

async function appendAfterSourceEof(path: string): Promise<() => void> {
  const probe = await open(path, 'r')
  const expected = await probe.stat()
  const prototype = Object.getPrototypeOf(probe) as {
    read: (...args: unknown[]) => Promise<{ bytesRead: number }>
  }
  await probe.close()
  const originalRead = prototype.read
  let appended = false
  prototype.read = async function (
    this: { stat: () => Promise<{ dev: number; ino: number }> },
    ...args: unknown[]
  ): Promise<{ bytesRead: number }> {
    const result = await originalRead.apply(this, args)
    const info = await this.stat()
    if (
      !appended &&
      result.bytesRead === 0 &&
      info.dev === expected.dev &&
      info.ino === expected.ino
    ) {
      appended = true
      await appendFile(path, '\n')
    }
    return result
  }
  return () => {
    prototype.read = originalRead
  }
}

async function overwriteDuringSourceRead(path: string): Promise<() => void> {
  const probe = await open(path, 'r')
  const expected = await probe.stat()
  const prototype = Object.getPrototypeOf(probe) as {
    read: (...args: unknown[]) => Promise<{ bytesRead: number }>
  }
  await probe.close()
  const originalRead = prototype.read
  let overwritten = false
  prototype.read = async function (
    this: { stat: () => Promise<{ dev: number; ino: number }> },
    ...args: unknown[]
  ): Promise<{ bytesRead: number }> {
    const result = await originalRead.apply(this, args)
    const info = await this.stat()
    if (
      !overwritten &&
      result.bytesRead > 0 &&
      info.dev === expected.dev &&
      info.ino === expected.ino
    ) {
      overwritten = true
      await writeFile(path, await readFile(path))
    }
    return result
  }
  return () => {
    prototype.read = originalRead
  }
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
    expect(await readdir(result.directory)).toContain('.agent-blackboard-partition-owner')
    await snapshots.cleanup({ path, directory: result.directory })
    await expect(readdir(result.directory)).rejects.toThrow()
    await expect(readFile(path)).rejects.toThrow()
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
    await expect(snapshots.partition({ path: invalid })).rejects.toThrow('unsupported record')
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

it('rejects post-EOF source growth and removes staging and output directories after late failure', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const path = await snapshot()
  const before = await partitionArtifacts()
  await chmod(path, 0o600)
  const restoreRead = await appendAfterSourceEof(path)
  try {
    await expect(snapshots.partition({ path })).rejects.toThrow('changed while it was being read')
    expect((await partitionArtifacts()).filter((name) => !before.includes(name))).toEqual([])
  } finally {
    restoreRead()
  }
  const lateFailure = await snapshot()
  await expect(snapshots.partition({ path: lateFailure, maxBytes: 1 })).rejects.toThrow('too large')
  expect((await partitionArtifacts()).filter((name) => !before.includes(name))).toEqual([])
})

it('rejects same-size source changes during staging and restores a retryable cleanup path', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const before = await partitionArtifacts()
  const source = await snapshot()
  await chmod(source, 0o600)
  const restoreRead = await overwriteDuringSourceRead(source)
  try {
    await expect(snapshots.partition({ path: source })).rejects.toThrow(
      'changed while it was being read',
    )
    expect((await partitionArtifacts()).filter((name) => !before.includes(name))).toEqual([])
  } finally {
    restoreRead()
  }
  const result = await snapshots.partition({ path: await snapshot() })
  await chmod(result.directory, 0o500)
  await expect(snapshots.cleanup({ directory: result.directory })).rejects.toThrow(
    'snapshot cleanup failed',
  )
  await expect(readdir(result.directory)).resolves.toContain('.agent-blackboard-partition-owner')
  await chmod(result.directory, 0o700)
  await expect(snapshots.cleanup({ directory: result.directory })).resolves.toBeUndefined()
})

it('validates generated paths, record structure, limits, and cleanup targets', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const originalManifest = sourceRecords().at(-1) as { manifest: Record<string, unknown> }
  const valid = await snapshot()
  const malformed = await snapshot([{ type: 'entry', entry: { sessionId: 'one' } }])
  const entryBeforeSession = await snapshot([
    {
      type: 'entry',
      entry: { sessionId: 'one', createdAt: '2026-01-01T00:00:00.000Z', data: {} },
    },
  ])
  const noManifest = await snapshot(sourceRecords().slice(0, -1))
  const blank = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(blank, '\n', { mode: 0o400 })
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
    await expect(snapshots.partition({ path: entryBeforeSession })).rejects.toThrow(
      'entries must follow',
    )
    await expect(snapshots.partition({ path: noManifest })).rejects.toThrow('complete terminal')
    await expect(snapshots.partition({ path: blank })).rejects.toThrow('blank JSONL')
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
    await expect(snapshots.cleanup({ directory: notDirectory })).rejects.toThrow(
      'not a generated directory',
    )
    const callerDirectory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await expect(snapshots.cleanup({ directory: callerDirectory })).rejects.toThrow(
      'owned generated partition directory',
    )
    await expect(readdir(callerDirectory)).resolves.toEqual([])
    await rm(callerDirectory, { recursive: true, force: true })
    const forgedMarker = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await writeFile(join(forgedMarker, '.agent-blackboard-partition-owner'), 'not-a-uuid\n')
    await expect(snapshots.cleanup({ directory: forgedMarker })).rejects.toThrow(
      'owned generated partition directory',
    )
    await rm(forgedMarker, { recursive: true, force: true })
    const linkedMarker = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    const markerTarget = join(linkedMarker, 'marker-target')
    await writeFile(markerTarget, `${randomUUID()}\n`)
    await symlink(markerTarget, join(linkedMarker, '.agent-blackboard-partition-owner'))
    await expect(snapshots.cleanup({ directory: linkedMarker })).rejects.toThrow(
      'owned generated partition directory',
    )
    await rm(linkedMarker, { recursive: true, force: true })
    const hardlink = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await link(valid, hardlink)
    await expect(snapshots.partition({ path: hardlink })).rejects.toThrow(
      'unlinked generated regular file',
    )
    await rm(hardlink, { force: true })
    const symlinked = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await symlink(valid, symlinked)
    await expect(snapshots.partition({ path: symlinked })).rejects.toThrow(
      'unlinked generated regular file',
    )
    await rm(symlinked, { force: true })
    await expect(snapshots.cleanup({ directory: 'relative' })).rejects.toThrow(
      'generated temporary',
    )
  } finally {
    await rm(valid, { force: true })
    await rm(malformed, { force: true })
    await rm(entryBeforeSession, { force: true })
    await rm(noManifest, { force: true })
    await rm(blank, { force: true })
    await rm(afterManifest, { force: true })
    await rm(invalidJson, { force: true })
    await rm(empty, { force: true })
    await rm(notDirectory, { force: true })
  }
})

it('streams many session blocks through private staging and cleans each requested artifact', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const sessions = Array.from({ length: 130 }, (_, index) => ({
    type: 'session',
    session: {
      id: `stream-${index}`,
      parentSessionId: null,
      agent: 'agent',
      version: '1',
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      lastEntryAt: null,
      archivedAt: null,
      data: { index },
    },
  }))
  const source = await snapshot([
    ...sessions,
    {
      type: 'manifest',
      manifest: {
        ...(sourceRecords().at(-1) as { manifest: Record<string, unknown> }).manifest,
        counts: { sessions: sessions.length, entries: 0, records: sessions.length + 1 },
      },
    },
  ])
  const first = await snapshots.partition({ path: source, maxSessions: 25 })
  expect(first.partitions).toHaveLength(6)
  await snapshots.cleanup({ path: source })
  await expect(readFile(source)).rejects.toThrow()
  expect(
    (await readdir(first.directory)).filter((name) => name.startsWith('partition-')),
  ).toHaveLength(6)
  await snapshots.cleanup({ directory: first.directory })
  await expect(readdir(first.directory)).rejects.toThrow()
})

it('attempts both cleanup targets and aggregates an unsafe target failure', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  await expect(snapshots.cleanup({})).rejects.toThrow('requires a snapshot path')
  const path = await snapshot()
  const unsafeDirectory = join(
    tmpdir(),
    `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`,
  )
  await writeFile(unsafeDirectory, 'not a directory')
  try {
    await expect(snapshots.cleanup({ path, directory: unsafeDirectory })).rejects.toThrow(
      'snapshot cleanup failed',
    )
    await expect(readFile(path)).rejects.toThrow()
    await expect(readFile(unsafeDirectory, 'utf8')).resolves.toBe('not a directory')
  } finally {
    await rm(unsafeDirectory, { force: true })
  }
})
