import { constants } from 'node:fs'
import fileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { SnapshotCleanupOptions } from './types.mjs'

const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const DIRECTORY_NAME = /^agent-blackboard-partitions-[0-9a-f-]{36}$/
const OWNERSHIP_MARKER = '.agent-blackboard-partitions'

function assertGeneratedPath(path: string, expression: RegExp, label: string): void {
  if (
    !isAbsolute(path) ||
    dirname(resolve(path)) !== resolve(tmpdir()) ||
    !expression.test(basename(path))
  )
    throw new Error(`${label} must be a generated temporary ${label}`)
}

async function assertOwnershipMarker(directory: string, identity: string): Promise<void> {
  let marker
  try {
    marker = await fileSystem.open(
      join(directory, OWNERSHIP_MARKER),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    const info = await marker.stat()
    if (!info.isFile() || info.nlink !== 1 || (await marker.readFile('utf8')) !== `${identity}\n`)
      throw new Error('partition directory does not contain its ownership marker')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('partition directory does not contain its ownership marker')
    throw error
  } finally {
    /* v8 ignore next -- marker close failure requires an OS-level fault */
    await marker?.close().catch(() => undefined)
  }
}

async function removeCaptured(path: string, expression: RegExp, directory: boolean): Promise<void> {
  const label = directory ? 'partition directory' : 'snapshot path'
  assertGeneratedPath(path, expression, label)
  let initial
  try {
    initial = await fileSystem.lstat(path)
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
  const identity = basename(path)
  if (directory) await assertOwnershipMarker(path, identity)
  const tombstone = join(
    tmpdir(),
    `.agent-blackboard-cleanup-${process.pid}-${crypto.randomUUID()}`,
  )
  let capturedPath = false
  try {
    await fileSystem.rename(path, tombstone)
    capturedPath = true
    const captured = await fileSystem.lstat(tombstone)
    /* v8 ignore next -- replacement after random tombstone rename is race-only */
    if (
      captured.isSymbolicLink() ||
      captured.dev !== initial.dev ||
      captured.ino !== initial.ino ||
      captured.isDirectory() !== directory ||
      (!directory && (!captured.isFile() || captured.nlink !== 1))
    )
      throw new Error(`${label} changed while it was being removed`)
    if (directory) await assertOwnershipMarker(tombstone, identity)
    await fileSystem.rm(tombstone, { recursive: directory, force: true })
  } catch (error: unknown) {
    /* v8 ignore next -- concurrent removal after capture is harmless */
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !capturedPath) return
    /* v8 ignore next -- only a non-ENOENT rename failure reaches this without capture */
    if (!capturedPath) throw error
    try {
      if (directory) {
        try {
          await fileSystem.writeFile(join(tombstone, OWNERSHIP_MARKER), `${identity}\n`, {
            flag: 'wx',
            mode: 0o400,
          })
        } catch (markerError: unknown) {
          /* v8 ignore next -- a non-EEXIST marker repair failure needs an OS-level fault */
          if ((markerError as NodeJS.ErrnoException).code !== 'EEXIST') throw markerError
        }
      }
      await fileSystem.rename(tombstone, path)
    } catch (restoreError: unknown) {
      /* v8 ignore start -- restore failure requires a concurrent replacement or OS fault */
      /* v8 ignore next -- a fully removed tombstone means cleanup ultimately succeeded */
      if ((restoreError as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new AggregateError(
        [error, restoreError],
        `${label} cleanup failed; retained retryable artifact at ${tombstone}`,
      )
      /* v8 ignore stop */
    }
    /* v8 ignore next -- non-ENOENT removal failure requires an OS-level fault */
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
