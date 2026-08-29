import { randomUUID } from 'node:crypto'
import { chmod, link, lstat, mkdtemp, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Identity = { dev: bigint; ino: bigint }

function isPrivateFile(stats: Awaited<ReturnType<typeof lstat>>): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1n
}

function hasIdentity(stats: Identity, expected: Identity): boolean {
  return stats.dev === expected.dev && stats.ino === expected.ino
}

async function assertDirectoryIdentity(
  directory: string,
  expected: Identity | undefined,
  label: string,
): Promise<void> {
  if (!expected) return
  const stats = await lstat(directory, { bigint: true })
  if (!stats.isDirectory() || !hasIdentity(stats, expected))
    throw new Error(`${label} changed while it was being removed`)
}

export async function removeDetached(
  path: string,
  quarantine: string,
  label: string,
  expected?: Identity,
): Promise<void> {
  const before = await lstat(path, { bigint: true })
  if (!isPrivateFile(before) || (expected && !hasIdentity(before, expected)))
    throw new Error(`${label} changed while it was being removed`)
  const detached = join(quarantine, `.entry-${randomUUID()}`)
  await rename(path, detached)
  const after = await lstat(detached, { bigint: true })
  /* v8 ignore start -- replacing a detached entry between rename and stat is race-only */
  if (!isPrivateFile(after) || !hasIdentity(after, before)) {
    /* v8 ignore next -- replacing a detached entry between rename and stat is race-only */
    throw new Error(`${label} changed while it was being removed`)
  }
  /* v8 ignore stop */
  await rm(detached, { force: true })
}

/** Removes one private regular file without following or recursively deleting a path. */
export async function removeOwnedFile(
  path: string,
  label: string,
  expected: Identity,
): Promise<void> {
  const quarantine = await mkdtemp(join(tmpdir(), '.agent-blackboard-cleanup-'))
  await chmod(quarantine, 0o700)
  try {
    await removeDetached(path, quarantine, label, expected)
  } finally {
    /* v8 ignore next -- a concurrent quarantine replacement is OS-race-only; never recurse */
    await rmdir(quarantine).catch(() => undefined)
  }
}

async function privateChildren(
  directory: string,
  label: string,
): Promise<Array<{ path: string; identity: Identity }>> {
  const entries = await readdir(directory)
  return Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry)
      const identity = await lstat(path, { bigint: true })
      if (!isPrivateFile(identity)) throw new Error(`${label} contains an unsafe entry`)
      return { path, identity }
    }),
  )
}

export async function assertDirectoryContents(
  directory: string,
  label: string,
  expected?: Identity,
): Promise<void> {
  await assertDirectoryIdentity(directory, expected, label)
  await privateChildren(directory, label)
  await assertDirectoryIdentity(directory, expected, label)
}

export async function removeDirectoryContents(
  directory: string,
  quarantine: string,
  label: string,
  expected?: Identity,
): Promise<void> {
  await assertDirectoryIdentity(directory, expected, label)
  const children = await privateChildren(directory, label)
  await assertDirectoryIdentity(directory, expected, label)
  for (const child of children) {
    await assertDirectoryIdentity(directory, expected, label)
    await removeDetached(child.path, quarantine, label, child.identity)
  }
  await assertDirectoryIdentity(directory, expected, label)
  await rmdir(directory)
}

/** Removes a private, direct-entry-only directory without recursive path deletion. */
export async function removeOwnedDirectory(
  directory: string,
  label: string,
  expected?: Identity,
): Promise<void> {
  const quarantine = await mkdtemp(join(tmpdir(), '.agent-blackboard-cleanup-'))
  await chmod(quarantine, 0o700)
  try {
    await removeDirectoryContents(directory, quarantine, label, expected)
  } finally {
    /* v8 ignore next -- a concurrent quarantine replacement is OS-race-only; never recurse */
    await rmdir(quarantine).catch(() => undefined)
  }
}

async function restoreFile(original: string, captured: string, expected: Identity): Promise<void> {
  const identity = await lstat(captured, { bigint: true })
  /* v8 ignore start -- a restore identity mismatch requires an OS-level race */
  if (!isPrivateFile(identity) || !hasIdentity(identity, expected)) {
    /* v8 ignore next -- a restore identity mismatch requires an OS-level race */
    throw new Error('captured artifact changed while it was being restored')
  }
  /* v8 ignore stop */
  await link(captured, original)
  await rm(captured, { force: true })
}

export async function restore(
  original: string,
  captured: string,
  marker: string | undefined,
  capturedMarker: string | undefined,
  expected: Identity,
  expectedMarker: Identity | undefined,
): Promise<void> {
  const errors: unknown[] = []
  if (marker && capturedMarker) {
    try {
      await restoreFile(marker, capturedMarker, expectedMarker!)
    } catch (error) {
      /* v8 ignore next -- restoring a marker fails only after an OS-level race or fault */
      errors.push(error)
    }
  }
  try {
    await restoreFile(original, captured, expected)
  } catch (error) {
    /* v8 ignore next -- restoring a source fails only after an OS-level race or fault */
    errors.push(error)
  }
  /* v8 ignore next -- aggregate restore failure requires an OS-level race or fault */
  if (errors.length)
    throw new AggregateError(errors, 'artifact cleanup could not restore its target')
}
