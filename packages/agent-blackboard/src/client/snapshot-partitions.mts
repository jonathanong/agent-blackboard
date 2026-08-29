import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { stageSnapshot } from './snapshot-partition-read.mjs'
import { writePartitions } from './snapshot-partition-write.mjs'
import { cleanupSnapshotPartitions } from './snapshot-partition-cleanup.mjs'
import { removeOwnedDirectory, type Identity } from './snapshot-artifact-removal.mjs'
import {
  assertCleanupToken,
  assertGeneratedPath,
  assertSnapshotMarker,
  knownCleanupToken,
  SOURCE_NAME,
  writePartitionMarker,
} from './snapshot-artifact-ownership.mjs'
import type {
  SnapshotManifest,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
} from './types.mjs'

const MAX_SESSIONS = 25
const MAX_BYTES = 1024 * 1024
function assertLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error(`${label} must be a positive integer`)
  return limit
}

function assertVerification(
  bytes: number,
  checksum: string,
  manifest: SnapshotManifest,
  options: SnapshotPartitionOptions,
): void {
  if (
    options.checksum &&
    (options.checksum.algorithm !== 'sha256' || options.checksum.value !== checksum)
  )
    throw new Error('snapshot checksum does not match')
  if (
    options.counts &&
    (options.counts.bytes !== bytes ||
      options.counts.sessions !== manifest.counts.sessions ||
      options.counts.entries !== manifest.counts.entries ||
      options.counts.records !== manifest.counts.records)
  ) {
    throw new Error('snapshot counts do not match')
  }
}

/** Splits a generated snapshot into bounded, whole-session, read-only JSONL files. */
export async function partitionSnapshot(
  options: SnapshotPartitionOptions,
): Promise<SnapshotPartitionResult> {
  if (!isAbsolute(options.path)) throw new Error('snapshot path must be absolute')
  assertGeneratedPath(options.path, SOURCE_NAME, 'snapshot path')
  const cleanupToken = options.cleanupToken ?? knownCleanupToken(options.path)
  assertCleanupToken(cleanupToken)
  const before = await lstat(options.path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
    throw new Error('snapshot path must be an unlinked generated regular file')
  let source: FileHandle | undefined
  let stage: string | undefined
  let stageIdentity: Identity | undefined
  let directory: string | undefined
  let directoryIdentity: Identity | undefined
  let directoryMarked = false
  try {
    source = await open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    stage = await mkdtemp(resolve(tmpdir(), 'agent-blackboard-partition-stage-'))
    await chmod(stage, 0o700)
    const stageStats = await lstat(stage, { bigint: true })
    stageIdentity = { dev: stageStats.dev, ino: stageStats.ino }
    directory = await mkdtemp(resolve(tmpdir(), 'agent-blackboard-partitions-'))
    await chmod(directory, 0o700)
    const directoryStats = await lstat(directory, { bigint: true })
    directoryIdentity = { dev: directoryStats.dev, ino: directoryStats.ino }
    await writePartitionMarker(directory, cleanupToken)
    directoryMarked = true
    const opened = await source.stat({ bigint: true })
    /* v8 ignore next -- a replacement between lstat and O_NOFOLLOW open is race-only */
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new Error('snapshot path changed while it was being opened')
    await assertSnapshotMarker(options.path, source, cleanupToken)
    const staged = await stageSnapshot(source, stage)
    const after = await source.stat({ bigint: true })
    /* v8 ignore next -- source mutation during an owned read-only descriptor is race-only */
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.nlink !== 1n ||
      opened.size !== BigInt(staged.bytes) ||
      after.size !== BigInt(staged.bytes) ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    )
      throw new Error('snapshot path changed while it was being read')
    await source.close()
    source = undefined
    assertVerification(staged.bytes, staged.checksum, staged.manifest, options)
    const partitions = await writePartitions(
      staged.index,
      staged.indexIdentity,
      staged.manifest,
      directory,
      assertLimit(options.maxSessions, MAX_SESSIONS, 'maxSessions'),
      assertLimit(options.maxBytes, MAX_BYTES, 'maxBytes'),
    )
    return { directory, partitions, cleanupToken }
  } catch (error) {
    /* v8 ignore next -- allocation failures before a directory exists are not deterministic in tests */
    if (directoryMarked && directory) {
      await cleanupSnapshotPartitions({ directory, cleanupToken }).catch(() => undefined)
    } else if (directory && directoryIdentity) {
      await removeOwnedDirectory(directory, 'partition directory', directoryIdentity).catch(
        () => undefined,
      )
    }
    throw error
  } finally {
    /* v8 ignore next -- best-effort descriptor closure must not mask the original failure */
    await source?.close().catch(() => undefined)
    /* v8 ignore next -- allocation failures before staging are not deterministic in tests */
    if (stage && stageIdentity)
      await removeOwnedDirectory(stage, 'partition staging directory', stageIdentity).catch(
        () => undefined,
      )
  }
}
