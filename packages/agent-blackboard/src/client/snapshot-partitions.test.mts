import { createHash, randomUUID } from 'node:crypto'
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  assertSnapshotMarker,
  createCleanupToken,
  knownCleanupToken,
  writePartitionMarker,
  writeSnapshotMarker,
} from './snapshot-artifact-ownership.mjs'
import { removeDetached, removeDirectoryContents, restore } from './snapshot-artifact-removal.mjs'
import { assertExactFile, copyBlock } from './snapshot-partition-copy.mjs'
import { readLines } from './snapshot-partition-io.mjs'
import { stageSnapshot } from './snapshot-partition-read.mjs'
import { assertPartitionFile, writePartitions } from './snapshot-partition-write.mjs'
import { Snapshots } from './snapshots.mjs'

const snapshotsToRemove = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...snapshotsToRemove].flatMap((path) => [
      rm(path, { force: true }),
      rm(`${path}.owner`, { force: true }),
    ]),
  )
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

async function snapshot(records: unknown[] | string = sourceRecords()): Promise<string> {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  const contents =
    typeof records === 'string'
      ? records
      : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  await writeFile(path, contents, {
    mode: 0o400,
  })
  const file = await open(path, 'r')
  await writeSnapshotMarker(path, file, createCleanupToken())
  await file.close()
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
    await expect(
      snapshots.cleanup({ directory: result.directory, cleanupToken: createCleanupToken() }),
    ).rejects.toThrow('ownership marker')
    await expect(
      snapshots.cleanup({ directory: result.directory, cleanupToken: 'not-a-capability' }),
    ).rejects.toThrow('cleanupToken must be a valid generated capability')
    await expect(readdir(result.directory)).resolves.toContain('.agent-blackboard-partition-owner')
    await snapshots.cleanup({ path, directory: result.directory })
    await expect(readdir(result.directory)).rejects.toThrow()
    await expect(readFile(path)).rejects.toThrow()
    await expect(snapshots.cleanup({ directory: result.directory })).resolves.toBeUndefined()
  } finally {
    await rm(path, { force: true })
  }
})

it('rejects caller-owned paths that resemble generated snapshots', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const source = await snapshot()
  const callerPath = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(callerPath, await readFile(source), { mode: 0o400 })
  const token = knownCleanupToken(source)!
  try {
    await expect(snapshots.partition({ path: callerPath, cleanupToken: token })).rejects.toThrow(
      'ownership marker',
    )
    await expect(snapshots.cleanup({ path: callerPath, cleanupToken: token })).rejects.toThrow(
      'ownership marker',
    )
    await expect(readFile(callerPath)).resolves.toBeTruthy()
  } finally {
    await rm(callerPath, { force: true })
  }
})

it('rejects a generated path replaced after export because its marker is stale', async () => {
  const snapshots = new Snapshots({ baseUrl: 'http://unused', token: 'unused' })
  const source = await snapshot()
  const replacement = join(tmpdir(), `replacement-${randomUUID()}.jsonl`)
  await writeFile(replacement, await readFile(source), { mode: 0o400 })
  await rm(source, { force: true })
  await rename(replacement, source)
  try {
    await expect(snapshots.partition({ path: source })).rejects.toThrow('ownership marker')
  } finally {
    await rm(source, { force: true })
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
    await expect(
      snapshots.cleanup({ directory: outside, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('temporary partition directory')
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
  const blank = await snapshot('\n')
  const afterManifest = await snapshot([
    ...sourceRecords(),
    { type: 'session', session: { id: 'three' } },
  ])
  const invalidJson = await snapshot('{invalid\n')
  const empty = await snapshot([
    {
      type: 'manifest',
      manifest: {
        ...originalManifest.manifest,
        counts: { sessions: 0, entries: 0, records: 1 },
      },
    },
  ])
  const notDirectory = join(tmpdir(), `agent-blackboard-partitions-${randomUUID()}`)
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
    const notFile = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await mkdir(notFile)
    await expect(
      snapshots.cleanup({ path: notFile, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('not a generated regular file')
    await rm(notFile, { recursive: true, force: true })
    const callerDirectory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await expect(
      snapshots.cleanup({ directory: callerDirectory, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('ownership marker')
    await expect(readdir(callerDirectory)).resolves.toEqual([])
    await rm(callerDirectory, { recursive: true, force: true })
    const forgedMarker = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await writeFile(join(forgedMarker, '.agent-blackboard-partition-owner'), '{}\n')
    await expect(
      snapshots.cleanup({ directory: forgedMarker, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('ownership marker')
    await rm(forgedMarker, { recursive: true, force: true })
    const malformedMarker = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await writeFile(join(malformedMarker, '.agent-blackboard-partition-owner'), 'not-json\n')
    await expect(
      snapshots.cleanup({ directory: malformedMarker, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('ownership marker')
    await rm(malformedMarker, { recursive: true, force: true })
    const owned = await snapshots.partition({ path: valid })
    const mismatchedDirectory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await chmod(mismatchedDirectory, 0o700)
    try {
      await writeFile(
        join(mismatchedDirectory, '.agent-blackboard-partition-owner'),
        await readFile(join(owned.directory, '.agent-blackboard-partition-owner')),
        { mode: 0o400 },
      )
      await expect(
        snapshots.cleanup({
          directory: mismatchedDirectory,
          cleanupToken: owned.cleanupToken,
        }),
      ).rejects.toThrow('does not match its directory')
      await expect(readdir(mismatchedDirectory)).resolves.toContain(
        '.agent-blackboard-partition-owner',
      )
    } finally {
      await rm(mismatchedDirectory, { recursive: true, force: true })
      await snapshots.cleanup({ directory: owned.directory, cleanupToken: owned.cleanupToken })
    }
    const unsafe = await snapshots.partition({ path: valid })
    const nested = join(unsafe.directory, 'nested')
    await mkdir(nested)
    try {
      await expect(
        snapshots.cleanup({ directory: unsafe.directory, cleanupToken: unsafe.cleanupToken }),
      ).rejects.toThrow('contains an unsafe entry')
      await expect(readdir(unsafe.directory)).resolves.toContain('nested')
    } finally {
      await rm(nested, { recursive: true, force: true })
      await snapshots.cleanup({ directory: unsafe.directory, cleanupToken: unsafe.cleanupToken })
    }
    const linkedMarker = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    const markerTarget = join(linkedMarker, 'marker-target')
    await writeFile(markerTarget, `${randomUUID()}\n`)
    await symlink(markerTarget, join(linkedMarker, '.agent-blackboard-partition-owner'))
    await expect(
      snapshots.cleanup({ directory: linkedMarker, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('ownership marker')
    await rm(linkedMarker, { recursive: true, force: true })
    const hardlink = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await link(valid, hardlink)
    await expect(
      snapshots.partition({ path: hardlink, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('unlinked generated regular file')
    await rm(hardlink, { force: true })
    const symlinked = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    await symlink(valid, symlinked)
    await expect(
      snapshots.partition({ path: symlinked, cleanupToken: knownCleanupToken(valid)! }),
    ).rejects.toThrow('unlinked generated regular file')
    await rm(symlinked, { force: true })
    await expect(snapshots.cleanup({ directory: 'relative' })).rejects.toThrow(
      'generated temporary',
    )
    for (const path of [
      'C:\\agent-blackboard-partitions-0123456789',
      '\\\\server\\share\\agent-blackboard-partitions-0123456789',
    ]) {
      await expect(snapshots.cleanup({ directory: path })).rejects.toThrow('generated temporary')
    }
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

it('does not detach artifacts when its captured identity is stale and restores atomically', async () => {
  const quarantine = await mkdtemp(join(tmpdir(), 'snapshot-quarantine-'))
  const path = join(quarantine, 'artifact')
  const wrongIdentity = { dev: 0n, ino: 0n }
  await writeFile(path, 'artifact', { mode: 0o400 })
  await expect(removeDetached(path, quarantine, 'artifact', wrongIdentity)).rejects.toThrow(
    'changed while it was being removed',
  )
  await expect(readFile(path, 'utf8')).resolves.toBe('artifact')

  const captured = join(quarantine, 'captured')
  const original = join(quarantine, 'restored')
  const capturedMarker = join(quarantine, 'captured.owner')
  const marker = join(quarantine, 'restored.owner')
  await writeFile(captured, 'captured', { mode: 0o400 })
  await writeFile(capturedMarker, 'marker', { mode: 0o400 })
  const identity = await stat(captured, { bigint: true })
  const markerIdentity = await stat(capturedMarker, { bigint: true })
  await restore(original, captured, marker, capturedMarker, identity, markerIdentity)
  await expect(readFile(original, 'utf8')).resolves.toBe('captured')
  await expect(readFile(marker, 'utf8')).resolves.toBe('marker')
  const noMarkerCaptured = join(quarantine, 'captured-no-marker')
  const noMarkerOriginal = join(quarantine, 'restored-no-marker')
  await writeFile(noMarkerCaptured, 'no-marker', { mode: 0o400 })
  const noMarkerIdentity = await stat(noMarkerCaptured, { bigint: true })
  await restore(
    noMarkerOriginal,
    noMarkerCaptured,
    undefined,
    undefined,
    noMarkerIdentity,
    undefined,
  )
  await expect(readFile(noMarkerOriginal, 'utf8')).resolves.toBe('no-marker')
  await rm(quarantine, { recursive: true, force: true })
})

it('does not remove directory contents when its captured identity is stale', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapshot-directory-'))
  const quarantine = await mkdtemp(join(tmpdir(), 'snapshot-quarantine-'))
  const child = join(directory, 'child')
  await writeFile(child, 'preserve', { mode: 0o400 })
  try {
    await expect(
      removeDirectoryContents(directory, quarantine, 'artifact', { dev: 0n, ino: 0n }),
    ).rejects.toThrow('changed while it was being removed')
    await expect(readFile(child, 'utf8')).resolves.toBe('preserve')
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(quarantine, { recursive: true, force: true })
  }
})

it('rejects hardlinked snapshot identities and non-directory ownership markers', async () => {
  const source = await snapshot()
  const hardlink = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  const markerTarget = join(
    tmpdir(),
    `agent-blackboard-partitions-${randomUUID().replaceAll('-', '')}`,
  )
  await link(source, hardlink)
  await writeFile(markerTarget, 'not-a-directory')
  const file = await open(hardlink, 'r')
  try {
    await expect(writeSnapshotMarker(hardlink, file, createCleanupToken())).rejects.toThrow(
      'private file',
    )
    await expect(assertSnapshotMarker(hardlink, file, createCleanupToken())).rejects.toThrow(
      'private file',
    )
    await expect(writePartitionMarker(markerTarget, createCleanupToken())).rejects.toThrow(
      'not a directory',
    )
  } finally {
    await file.close()
    await rm(hardlink, { force: true })
    await rm(markerTarget, { force: true })
  }
})

it('rejects every invalid partition publication identity', () => {
  const expected = { dev: 1n, ino: 2n }
  const valid = { isFile: () => true, nlink: 1n, dev: 1n, ino: 2n }
  expect(() => assertPartitionFile(valid, expected, 'invalid')).not.toThrow()
  for (const invalid of [
    { ...valid, isFile: () => false },
    { ...valid, nlink: 2n },
    { ...valid, dev: 3n },
    { ...valid, ino: 4n },
  ]) {
    expect(() => assertPartitionFile(invalid, expected, 'invalid')).toThrow('invalid')
  }
})

it('rejects every invalid exact staged-file identity', () => {
  const expected = { dev: 1n, ino: 2n, size: 3n }
  const valid = { isFile: () => true, nlink: 1n, dev: 1n, ino: 2n, size: 3n }
  expect(() => assertExactFile(valid, expected, 'invalid')).not.toThrow()
  for (const invalid of [
    { ...valid, isFile: () => false },
    { ...valid, nlink: 2n },
    { ...valid, dev: 3n },
    { ...valid, ino: 4n },
    { ...valid, size: 5n },
  ]) {
    expect(() => assertExactFile(invalid, expected, 'invalid')).toThrow('invalid')
  }
})

it('rejects a staged block appended after its descriptor is opened', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-copy-'))
  const blockPath = join(directory, 'session-1.jsonl')
  const outputPath = join(directory, 'partition.jsonl')
  const contents = Buffer.from('{"type":"session"}\n')
  await writeFile(blockPath, contents, { mode: 0o600 })
  const identity = await stat(blockPath, { bigint: true })
  const output = await open(outputPath, 'wx', 0o600)
  try {
    const originalWrite = output.write.bind(output) as (
      data: NodeJS.ArrayBufferView,
      offset?: number,
      length?: number,
      position?: number,
    ) => ReturnType<typeof output.write>
    let appended = false
    output.write = (async (data, offset, length, position) => {
      if (!appended) {
        appended = true
        await appendFile(blockPath, 'unexpected')
      }
      return originalWrite(data, offset ?? undefined, length ?? undefined, position ?? undefined)
    }) as typeof output.write
    await expect(
      copyBlock(
        {
          sessionId: 'one',
          path: blockPath,
          identity: { dev: String(identity.dev), ino: String(identity.ino) },
          bytes: contents.byteLength,
          sessions: 1,
          entries: 0,
        },
        output,
        createHash('sha256'),
      ),
    ).rejects.toThrow('staged snapshot block changed before publication')
  } finally {
    await output.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects a staged block that ends before its recorded byte count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-copy-'))
  const blockPath = join(directory, 'session-1.jsonl')
  const outputPath = join(directory, 'partition.jsonl')
  const contents = Buffer.from('{"type":"session"}\n')
  await writeFile(blockPath, contents, { mode: 0o600 })
  const identity = await stat(blockPath, { bigint: true })
  const output = await open(outputPath, 'wx', 0o600)
  try {
    await expect(
      copyBlock(
        {
          sessionId: 'one',
          path: blockPath,
          identity: { dev: String(identity.dev), ino: String(identity.ino) },
          bytes: contents.byteLength + 1,
          sessions: 1,
          entries: 0,
        },
        output,
        createHash('sha256'),
      ),
    ).rejects.toThrow('staged snapshot block changed before publication')
  } finally {
    await output.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects invalid staged block byte counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-copy-'))
  const blockPath = join(directory, 'session-1.jsonl')
  const outputPath = join(directory, 'partition.jsonl')
  await writeFile(blockPath, '{"type":"session"}\n', { mode: 0o600 })
  const identity = await stat(blockPath, { bigint: true })
  const output = await open(outputPath, 'wx', 0o600)
  try {
    for (const bytes of [-1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        copyBlock(
          {
            sessionId: 'one',
            path: blockPath,
            identity: { dev: String(identity.dev), ino: String(identity.ino) },
            bytes,
            sessions: 1,
            entries: 0,
          },
          output,
          createHash('sha256'),
        ),
      ).rejects.toThrow('staged snapshot block has an invalid identity')
    }
  } finally {
    await output.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('copies a staged block larger than one read buffer exactly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-copy-'))
  const blockPath = join(directory, 'session-1.jsonl')
  const outputPath = join(directory, 'partition.jsonl')
  const contents = Buffer.alloc(64 * 1024 + 1, 'x')
  await writeFile(blockPath, contents, { mode: 0o600 })
  const identity = await stat(blockPath, { bigint: true })
  const output = await open(outputPath, 'wx', 0o600)
  try {
    await copyBlock(
      {
        sessionId: 'one',
        path: blockPath,
        identity: { dev: String(identity.dev), ino: String(identity.ino) },
        bytes: contents.byteLength,
        sessions: 1,
        entries: 0,
      },
      output,
      createHash('sha256'),
    )
  } finally {
    await output.close()
  }
  try {
    await expect(readFile(outputPath)).resolves.toEqual(contents)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects a staged block truncated after descriptor verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-copy-'))
  const blockPath = join(directory, 'session-1.jsonl')
  const outputPath = join(directory, 'partition.jsonl')
  await writeFile(blockPath, '{"type":"session"}\n', { mode: 0o600 })
  const identity = await stat(blockPath, { bigint: true })
  const output = await open(outputPath, 'wx', 0o600)
  const control = await open(blockPath, 'r')
  const prototype = Object.getPrototypeOf(control) as {
    read: (this: unknown, ...args: unknown[]) => unknown
  }
  const originalRead = prototype.read
  let truncated = false
  prototype.read = async function (this: unknown, ...args: unknown[]) {
    if (!truncated) {
      truncated = true
      await truncate(blockPath, 0)
    }
    return Reflect.apply(originalRead, this, args)
  }
  try {
    await expect(
      copyBlock(
        {
          sessionId: 'one',
          path: blockPath,
          identity: { dev: String(identity.dev), ino: String(identity.ino) },
          bytes: Number(identity.size),
          sessions: 1,
          entries: 0,
        },
        output,
        createHash('sha256'),
      ),
    ).rejects.toThrow('staged snapshot block changed before publication')
  } finally {
    prototype.read = originalRead
    await control.close()
    await output.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects an index appended after its descriptor is opened', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-index-'))
  const index = join(directory, 'index.jsonl')
  const contents = Buffer.from('{"sessionId":"one"}\n')
  await writeFile(index, contents, { mode: 0o600 })
  const file = await open(index, 'r')
  try {
    const lines: string[] = []
    await expect(
      (async () => {
        for await (const line of readLines(
          file,
          undefined,
          async () => appendFile(index, 'unexpected'),
          BigInt(contents.byteLength),
          'staged snapshot index',
        ))
          lines.push(line)
      })(),
    ).rejects.toThrow('staged snapshot index changed during publication')
    expect(lines).toEqual(['{"sessionId":"one"}'])
  } finally {
    await file.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects short and invalid bounded index reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-index-'))
  const index = join(directory, 'index.jsonl')
  await writeFile(index, '{"sessionId":"one"}\n', { mode: 0o600 })
  const consume = async (expectedBytes: bigint) => {
    const file = await open(index, 'r')
    try {
      for await (const _line of readLines(file, undefined, undefined, expectedBytes, 'index')) {
        // Consume the generator so its bounded-read validation runs.
      }
    } finally {
      await file.close()
    }
  }
  try {
    await expect(consume(1024n)).rejects.toThrow('index changed during publication')
    for (const expectedBytes of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])
      await expect(consume(expectedBytes)).rejects.toThrow('index has an invalid size')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects a staged session path replaced before partition publication', async () => {
  const source = await snapshot()
  const stage = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-stage-'))
  const output = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
  const sourceFile = await open(source, 'r')
  try {
    const staged = await stageSnapshot(sourceFile, stage)
    const stagedPath = join(stage, 'session-1.jsonl')
    const replacement = join(stage, 'session-replacement.jsonl')
    const originalIndex = await readFile(staged.index, 'utf8')
    const [firstLine, ...remainingIndex] = originalIndex.trimEnd().split('\n')
    const block = JSON.parse(firstLine!) as Record<string, unknown>
    const writeIndex = async (next: Record<string, unknown>) => {
      await writeFile(staged.index, `${[JSON.stringify(next), ...remainingIndex].join('\n')}\n`)
      const identity = await stat(staged.index, { bigint: true })
      return { dev: String(identity.dev), ino: String(identity.ino), size: String(identity.size) }
    }
    const invalidBlockIndex = await writeIndex({ ...block, identity: { dev: 'invalid', ino: '1' } })
    const invalidIdentityOutput = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await expect(
      writePartitions(
        staged.index,
        invalidBlockIndex,
        staged.manifest,
        invalidIdentityOutput,
        25,
        1024 * 1024,
      ),
    ).rejects.toThrow('invalid identity')
    await rm(invalidIdentityOutput, { recursive: true, force: true })
    const invalidPathIndex = await writeIndex({
      ...block,
      path: join(stage, 'not-a-session.jsonl'),
    })
    const invalidPathOutput = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await expect(
      writePartitions(
        staged.index,
        invalidPathIndex,
        staged.manifest,
        invalidPathOutput,
        25,
        1024 * 1024,
      ),
    ).rejects.toThrow('block path is invalid')
    await rm(invalidPathOutput, { recursive: true, force: true })
    await writeFile(staged.index, originalIndex)
    const restoredIndex = await stat(staged.index, { bigint: true })
    for (const size of ['-1', String(BigInt(Number.MAX_SAFE_INTEGER) + 1n)]) {
      const invalidSizeOutput = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
      await expect(
        writePartitions(
          staged.index,
          { dev: String(restoredIndex.dev), ino: String(restoredIndex.ino), size },
          staged.manifest,
          invalidSizeOutput,
          25,
          1024 * 1024,
        ),
      ).rejects.toThrow('index has an invalid identity')
      await rm(invalidSizeOutput, { recursive: true, force: true })
    }
    const invalidIndexOutput = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await expect(
      writePartitions(
        staged.index,
        { dev: 'invalid', ino: 'invalid', size: 'invalid' },
        staged.manifest,
        invalidIndexOutput,
        25,
        1024 * 1024,
      ),
    ).rejects.toThrow('index has an invalid identity')
    await rm(invalidIndexOutput, { recursive: true, force: true })
    const replacedIndex = join(stage, 'index-replacement.jsonl')
    await writeFile(replacedIndex, originalIndex)
    await rm(staged.index, { force: true })
    await rename(replacedIndex, staged.index)
    const changedIndexOutput = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    await expect(
      writePartitions(
        staged.index,
        staged.indexIdentity,
        staged.manifest,
        changedIndexOutput,
        25,
        1024 * 1024,
      ),
    ).rejects.toThrow('index changed before publication')
    await rm(changedIndexOutput, { recursive: true, force: true })
    await rm(staged.index, { force: true })
    await writeFile(staged.index, originalIndex)
    const restoredIndexAfterReplacement = await stat(staged.index, { bigint: true })
    const restoredIndexIdentity = {
      dev: String(restoredIndexAfterReplacement.dev),
      ino: String(restoredIndexAfterReplacement.ino),
      size: String(restoredIndexAfterReplacement.size),
    }
    await writeFile(replacement, await readFile(stagedPath), { mode: 0o600 })
    await rm(stagedPath, { force: true })
    await rename(replacement, stagedPath)
    await expect(
      writePartitions(
        staged.index,
        restoredIndexIdentity,
        staged.manifest,
        output,
        25,
        1024 * 1024,
      ),
    ).rejects.toThrow('staged snapshot block changed before publication')
  } finally {
    await sourceFile.close()
    await rm(source, { force: true })
    await rm(`${source}.owner`, { force: true })
    await rm(stage, { recursive: true, force: true })
    await rm(output, { recursive: true, force: true })
  }
})

it('rejects staging through a replaced directory symlink', async () => {
  const source = await snapshot()
  const stage = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-stage-'))
  const originalStage = `${stage}-original`
  const victim = await mkdtemp(join(tmpdir(), 'snapshot-stage-victim-'))
  const sentinel = join(victim, 'sentinel')
  await writeFile(sentinel, 'preserve')
  await rename(stage, originalStage)
  await symlink(victim, stage)
  const sourceFile = await open(source, 'r')
  try {
    await expect(stageSnapshot(sourceFile, stage)).rejects.toThrow('private directory')
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserve')
  } finally {
    await sourceFile.close()
    await rm(source, { force: true })
    await rm(`${source}.owner`, { force: true })
    await rm(stage, { force: true })
    await rm(originalStage, { recursive: true, force: true })
    await rm(victim, { recursive: true, force: true })
  }
})

it('rejects publication through a replaced output directory symlink', async () => {
  const source = await snapshot()
  const stage = await mkdtemp(join(tmpdir(), 'agent-blackboard-partition-stage-'))
  const output = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
  const originalOutput = `${output}-original`
  const victim = await mkdtemp(join(tmpdir(), 'snapshot-output-victim-'))
  const sentinel = join(victim, 'sentinel')
  await writeFile(sentinel, 'preserve')
  const sourceFile = await open(source, 'r')
  try {
    const staged = await stageSnapshot(sourceFile, stage)
    await rename(output, originalOutput)
    await symlink(victim, output)
    await expect(
      writePartitions(staged.index, staged.indexIdentity, staged.manifest, output, 25, 1024 * 1024),
    ).rejects.toThrow('private directory')
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserve')
  } finally {
    await sourceFile.close()
    await rm(source, { force: true })
    await rm(`${source}.owner`, { force: true })
    await rm(stage, { recursive: true, force: true })
    await rm(originalOutput, { recursive: true, force: true })
    await rm(output, { force: true })
    await rm(victim, { recursive: true, force: true })
  }
})
