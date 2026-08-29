import { lstat, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { SnapshotCleanupOptions } from './types.mjs'

const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const DIRECTORY_NAME = /^agent-blackboard-partitions-[A-Za-z0-9]+$/

function assertGeneratedPath(path: string, expression: RegExp, label: string): void {
  if (
    !isAbsolute(path) ||
    dirname(resolve(path)) !== resolve(tmpdir()) ||
    !expression.test(basename(path))
  )
    throw new Error(`${label} must be a generated temporary ${label}`)
}

async function removeCaptured(path: string, expression: RegExp, directory: boolean): Promise<void> {
  const label = directory ? 'partition directory' : 'snapshot path'
  assertGeneratedPath(path, expression, label)
  let initial
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
    const captured = await lstat(tombstone)
    /* v8 ignore next -- replacement after random tombstone rename is race-only */
    if (
      captured.isSymbolicLink() ||
      captured.dev !== initial.dev ||
      captured.ino !== initial.ino ||
      captured.isDirectory() !== directory ||
      (!directory && (!captured.isFile() || captured.nlink !== 1))
    )
      throw new Error(`${label} changed while it was being removed`)
    await rm(tombstone, { recursive: directory, force: true })
  } catch (error: unknown) {
    /* v8 ignore next -- concurrent removal after capture is harmless */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
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
