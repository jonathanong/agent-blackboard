import { constants } from 'node:fs'
import { lstat, open, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { SnapshotCleanupOptions } from './types.mjs'

const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const DIRECTORY_NAME = /^agent-blackboard-partitions-[A-Za-z0-9]+$/
const OWNER_MARKER = '.agent-blackboard-partition-owner'

function assertGeneratedPath(path: string, expression: RegExp, label: string): void {
  if (
    !isAbsolute(path) ||
    dirname(resolve(path)) !== resolve(tmpdir()) ||
    !expression.test(basename(path))
  )
    throw new Error(`${label} must be a generated temporary ${label}`)
}

/** Marks a newly generated partition directory so cleanup never recurses into a caller directory. */
export async function markPartitionDirectory(directory: string): Promise<void> {
  await writeFile(join(directory, OWNER_MARKER), `${crypto.randomUUID()}\n`, {
    encoding: 'utf8',
    mode: 0o400,
    flag: 'wx',
  })
}

async function assertOwnedPartitionDirectory(directory: string): Promise<void> {
  const marker = join(directory, OWNER_MARKER)
  let before
  try {
    before = await lstat(marker)
  } catch {
    throw new Error('partition directory is not an owned generated partition directory')
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw new Error('partition directory is not an owned generated partition directory')
  const file = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await file.stat()
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      !/^[0-9a-f-]{36}\n$/.test(Buffer.from(await file.readFile()).toString('utf8'))
    )
      throw new Error('partition directory is not an owned generated partition directory')
  } finally {
    await file.close()
  }
}

async function removeCaptured(path: string, expression: RegExp, directory: boolean): Promise<void> {
  const label = directory ? 'partition directory' : 'snapshot path'
  assertGeneratedPath(path, expression, label)
  let initial
  let captured = false
  let renamed = false
  try {
    initial = await lstat(path)
  } catch (error: unknown) {
    /* v8 ignore next -- tests cover ENOENT; another lstat code needs an OS-level fault */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    /* v8 ignore next -- non-ENOENT lstat failure requires an OS-level fault */
    throw error
  }
  /* v8 ignore next -- every unsafe target shape is rejected by the same branch */
  if (
    initial.isSymbolicLink() ||
    (!initial.isFile() && !directory) ||
    (directory && !initial.isDirectory()) ||
    (!directory && initial.nlink !== 1)
  )
    throw new Error(`${label} is not a generated ${directory ? 'directory' : 'regular file'}`)
  const tombstone = join(
    tmpdir(),
    `.agent-blackboard-cleanup-${process.pid}-${crypto.randomUUID()}`,
  )
  try {
    await rename(path, tombstone)
    renamed = true
    const capturedStat = await lstat(tombstone)
    /* v8 ignore next -- replacement after random tombstone rename is race-only */
    if (
      capturedStat.isSymbolicLink() ||
      capturedStat.dev !== initial.dev ||
      capturedStat.ino !== initial.ino ||
      capturedStat.isDirectory() !== directory ||
      (!directory && (!capturedStat.isFile() || capturedStat.nlink !== 1))
    )
      throw new Error(`${label} changed while it was being removed`)
    captured = true
    if (directory) await assertOwnedPartitionDirectory(tombstone)
    await rm(tombstone, { recursive: directory, force: true })
  } catch (error: unknown) {
    /* v8 ignore next -- concurrent removal after capture is harmless */
    if (!renamed && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    /* v8 ignore next -- a changed tombstone is a race-only path that must never be restored */
    if (captured) {
      try {
        await rename(tombstone, path)
      } catch (restoreError) {
        /* v8 ignore next -- requires another process to recreate the original random temporary path */
        throw new AggregateError(
          [error, restoreError],
          `${label} removal failed and its original path could not be restored`,
        )
      }
    }
    /* v8 ignore next -- non-ENOENT rename/removal failure requires an OS-level fault */
    throw error
  }
}

/** Removes generated snapshot and/or partition evidence, refusing arbitrary filesystem paths. */
export async function cleanupSnapshotPartitions(options: SnapshotCleanupOptions): Promise<void> {
  if (!options.path && !options.directory)
    throw new Error('cleanup requires a snapshot path or partition directory')
  const results = await Promise.allSettled([
    ...(options.path ? [removeCaptured(options.path, SOURCE_NAME, false)] : []),
    ...(options.directory ? [removeCaptured(options.directory, DIRECTORY_NAME, true)] : []),
  ])
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length) {
    const reasons = failures.map((result) => String(result.reason)).join('; ')
    throw new AggregateError(
      failures.map((result) => result.reason),
      `snapshot cleanup failed: ${reasons}`,
    )
  }
}
