import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, rename, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { SnapshotCleanupOptions } from './types.mjs'
import {
  assertCleanupToken,
  assertGeneratedPath,
  assertPartitionMarker,
  assertSnapshotMarker,
  DIRECTORY_NAME,
  forgetCleanupToken,
  knownCleanupToken,
  snapshotMarkerPath,
  SOURCE_NAME,
} from './snapshot-artifact-ownership.mjs'
import {
  assertDirectoryContents,
  removeDetached,
  removeDirectoryContents,
  restore,
  type Identity,
} from './snapshot-artifact-removal.mjs'

async function assertSnapshotOwnership(path: string, token: string): Promise<void> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await assertSnapshotMarker(path, file, token)
  } finally {
    await file.close()
  }
}

async function removeEmpty(path: string): Promise<void> {
  await rmdir(path).catch(() => undefined)
}

async function removeCaptured(
  path: string,
  expression: RegExp,
  directory: boolean,
  token: string | undefined,
): Promise<void> {
  const label = directory ? 'partition directory' : 'snapshot path'
  assertGeneratedPath(path, expression, label)
  let initial
  try {
    initial = await lstat(path, { bigint: true })
  } catch (error) {
    /* v8 ignore start -- only ENOENT is deterministic; other codes need an OS fault */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
    /* v8 ignore stop */
  }
  /* v8 ignore start -- a replacement after the preflight check is race-only */
  if (
    initial.isSymbolicLink() ||
    (!directory && !initial.isFile()) ||
    (directory && !initial.isDirectory()) ||
    (!directory && initial.nlink !== 1n)
  )
    throw new Error(`${label} is not a generated ${directory ? 'directory' : 'regular file'}`)
  assertCleanupToken(token)
  if (directory) await assertPartitionMarker(path, token)
  else await assertSnapshotOwnership(path, token)
  if (directory) await assertDirectoryContents(path, label)

  const marker = directory ? undefined : snapshotMarkerPath(path)
  let markerIdentity: Identity | undefined
  if (!directory) {
    const identity = await lstat(marker!, { bigint: true })
    /* v8 ignore next -- replacing a validated marker before this lstat is race-only */
    if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1n)
      throw new Error(`${label} ownership marker changed`)
    markerIdentity = identity
  }
  const quarantine = await mkdtemp(join(tmpdir(), '.agent-blackboard-cleanup-'))
  await chmod(quarantine, 0o700)
  const captured = join(quarantine, basename(path))
  const capturedMarker = directory ? undefined : snapshotMarkerPath(captured)
  let moved = false
  let markerMoved = false
  try {
    await rename(path, captured)
    moved = true
    const capturedStat = await lstat(captured, { bigint: true })
    if (
      capturedStat.isSymbolicLink() ||
      capturedStat.dev !== initial.dev ||
      capturedStat.ino !== initial.ino ||
      capturedStat.isDirectory() !== directory ||
      (!directory && (!capturedStat.isFile() || capturedStat.nlink !== 1n))
    )
      /* v8 ignore next -- replacing the detached target between rename and stat is race-only */
      throw new Error(`${label} changed while it was being removed`)
    /* v8 ignore stop */
    if (directory) await assertPartitionMarker(captured, token)
    else {
      await rename(marker!, capturedMarker!)
      markerMoved = true
      await assertSnapshotOwnership(captured, token)
    }
    if (directory) {
      await removeDirectoryContents(captured, quarantine, label, initial)
    } else {
      await removeDetached(capturedMarker!, quarantine, `${label} ownership marker`, markerIdentity)
      await removeDetached(captured, quarantine, label, initial)
    }
    await rmdir(quarantine)
    forgetCleanupToken(path)
  } catch (error) {
    /* v8 ignore start -- post-detach failures require an OS-level race or filesystem fault */
    if (moved && !directory) {
      try {
        await restore(
          path,
          captured,
          markerMoved ? marker : undefined,
          capturedMarker,
          initial,
          markerIdentity,
        )
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'artifact cleanup failed and target was not restored',
        )
      }
    }
    /* v8 ignore stop */
    /* v8 ignore next -- preserve the primary pre-detach failure */
    throw error
  } finally {
    await removeEmpty(quarantine)
  }
}

/** Removes generated snapshot and/or partition evidence using an explicit capability. */
export async function cleanupSnapshotPartitions(options: SnapshotCleanupOptions): Promise<void> {
  if (!options.path && !options.directory)
    throw new Error('cleanup requires a snapshot path or partition directory')
  const inferredToken = options.path
    ? knownCleanupToken(options.path)
    : knownCleanupToken(options.directory!)
  const token = options.cleanupToken ?? inferredToken
  const results = await Promise.allSettled([
    ...(options.path ? [removeCaptured(options.path, SOURCE_NAME, false, token)] : []),
    ...(options.directory ? [removeCaptured(options.directory, DIRECTORY_NAME, true, token)] : []),
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
