import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { stageSnapshot } from './snapshot-partition-read.mjs'
import { writePartitions } from './snapshot-partition-write.mjs'
import { markPartitionDirectory } from './snapshot-partition-cleanup.mjs'
import type {
  SnapshotManifest,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
} from './types.mjs'

const MAX_SESSIONS = 25
const MAX_BYTES = 1024 * 1024
const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/

function assertLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error(`${label} must be a positive integer`)
  return limit
}

function assertGeneratedSnapshot(path: string): void {
  if (!isAbsolute(path)) throw new Error('snapshot path must be absolute')
  if (dirname(resolve(path)) !== resolve(tmpdir()) || !SOURCE_NAME.test(basename(path)))
    throw new Error('snapshot path must be a generated temporary snapshot path')
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
  assertGeneratedSnapshot(options.path)
  const before = await lstat(options.path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
    throw new Error('snapshot path must be an unlinked generated regular file')
  let source: FileHandle | undefined
  let stage: string | undefined
  let directory: string | undefined
  try {
    source = await open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    stage = await mkdtemp(resolve(tmpdir(), 'agent-blackboard-partition-stage-'))
    await chmod(stage, 0o700)
    directory = await mkdtemp(resolve(tmpdir(), 'agent-blackboard-partitions-'))
    await chmod(directory, 0o700)
    await markPartitionDirectory(directory)
    const opened = await source.stat({ bigint: true })
    /* v8 ignore next -- a replacement between lstat and O_NOFOLLOW open is race-only */
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new Error('snapshot path changed while it was being opened')
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
      staged.manifest,
      directory,
      assertLimit(options.maxSessions, MAX_SESSIONS, 'maxSessions'),
      assertLimit(options.maxBytes, MAX_BYTES, 'maxBytes'),
    )
    return { directory, partitions }
  } catch (error) {
    /* v8 ignore next -- allocation failures before a directory exists are not deterministic in tests */
    if (directory) await rm(directory, { recursive: true, force: true })
    throw error
  } finally {
    /* v8 ignore next -- best-effort descriptor closure must not mask the original failure */
    await source?.close().catch(() => undefined)
    /* v8 ignore next -- allocation failures before staging are not deterministic in tests */
    if (stage) await rm(stage, { recursive: true, force: true })
  }
}
