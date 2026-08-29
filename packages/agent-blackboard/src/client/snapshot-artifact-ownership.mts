import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
export const DIRECTORY_NAME = /^agent-blackboard-partitions-[A-Za-z0-9]+$/
const OWNER_MARKER = '.agent-blackboard-partition-owner'

const SOURCE_MARKER_SUFFIX = '.owner'
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const capabilities = new Map<string, string>()
const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_ABSOLUTE = /^(?:\\\\|\/\/)/

type ArtifactKind = 'snapshot' | 'partition-directory'
type ArtifactIdentity = { dev: bigint; ino: bigint }

type Marker = {
  version: 1
  kind: ArtifactKind
  tokenHash: string
  dev: string
  ino: string
}

export function createCleanupToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function assertCleanupToken(token: string | undefined): asserts token is string {
  if (token === undefined || !TOKEN_PATTERN.test(token))
    throw new Error('cleanupToken must be a valid generated capability')
}

function rememberCleanupToken(path: string, token: string): void {
  capabilities.set(path, token)
}

export function knownCleanupToken(path: string): string | undefined {
  return capabilities.get(path)
}

export function forgetCleanupToken(path: string): void {
  capabilities.delete(path)
}

export function assertGeneratedPath(path: string, expression: RegExp, label: string): void {
  if (
    (!isAbsolute(path) && !WINDOWS_DRIVE_ABSOLUTE.test(path) && !WINDOWS_UNC_ABSOLUTE.test(path)) ||
    dirname(resolve(path)) !== resolve(tmpdir()) ||
    !expression.test(basename(path))
  )
    throw new Error(`${label} must be a generated temporary ${label}`)
}

export function snapshotMarkerPath(path: string): string {
  return `${path}${SOURCE_MARKER_SUFFIX}`
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function markerText(marker: Marker): string {
  return `${JSON.stringify(marker)}\n`
}

function identityOf(stats: ArtifactIdentity): { dev: string; ino: string } {
  return { dev: String(stats.dev), ino: String(stats.ino) }
}

function parseMarker(value: string, kind: ArtifactKind): Marker {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`invalid ${kind} ownership marker`)
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Marker).version !== 1 ||
    (parsed as Marker).kind !== kind ||
    !HASH_PATTERN.test((parsed as Marker).tokenHash) ||
    typeof (parsed as Marker).dev !== 'string' ||
    typeof (parsed as Marker).ino !== 'string'
  )
    throw new Error(`invalid ${kind} ownership marker`)
  return parsed as Marker
}

async function readMarker(path: string, kind: ArtifactKind, token: string): Promise<Marker> {
  let before
  try {
    before = await lstat(path, { bigint: true })
  } catch {
    throw new Error(`invalid ${kind} ownership marker`)
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
    throw new Error(`invalid ${kind} ownership marker`)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await file.stat({ bigint: true })
    /* v8 ignore start -- descriptor identity mismatch requires an OS-level replacement race */
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      /* v8 ignore next -- replacing an ownership marker between lstat and descriptor stat is race-only */
      throw new Error(`invalid ${kind} ownership marker`)
    /* v8 ignore stop */
    const marker = parseMarker((await file.readFile()).toString('utf8'), kind)
    if (marker.tokenHash !== tokenHash(token)) throw new Error(`invalid ${kind} ownership marker`)
    return marker
  } finally {
    await file.close()
  }
}

async function writeMarker(
  path: string,
  kind: ArtifactKind,
  token: string,
  identity: ArtifactIdentity,
) {
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o400,
  )
  try {
    await file.writeFile(
      markerText({ version: 1, kind, tokenHash: tokenHash(token), ...identityOf(identity) }),
      'utf8',
    )
    await file.sync()
    await file.chmod(0o400)
  } finally {
    await file.close()
  }
}

export async function writeSnapshotMarker(
  path: string,
  source: FileHandle,
  token: string,
): Promise<void> {
  const identity = await source.stat({ bigint: true })
  if (!identity.isFile() || identity.nlink !== 1n) throw new Error('snapshot is not a private file')
  await writeMarker(snapshotMarkerPath(path), 'snapshot', token, identity)
  rememberCleanupToken(path, token)
}

export async function assertSnapshotMarker(
  path: string,
  source: FileHandle,
  token: string,
): Promise<void> {
  const identity = await source.stat({ bigint: true })
  if (!identity.isFile() || identity.nlink !== 1n) throw new Error('snapshot is not a private file')
  const marker = await readMarker(snapshotMarkerPath(path), 'snapshot', token)
  const expected = identityOf(identity)
  if (marker.dev !== expected.dev || marker.ino !== expected.ino)
    throw new Error('snapshot ownership marker does not match its file')
}

export async function writePartitionMarker(directory: string, token: string): Promise<void> {
  const identity = await lstat(directory, { bigint: true })
  if (!identity.isDirectory()) throw new Error('partition directory is not a directory')
  await writeMarker(join(directory, OWNER_MARKER), 'partition-directory', token, identity)
  rememberCleanupToken(directory, token)
}

export async function assertPartitionMarker(directory: string, token: string): Promise<void> {
  const identity = await lstat(directory, { bigint: true })
  if (!identity.isDirectory() || (identity.mode & 0o777n) !== 0o700n)
    throw new Error('partition directory is not a private generated directory')
  const marker = await readMarker(join(directory, OWNER_MARKER), 'partition-directory', token)
  const expected = identityOf(identity)
  if (marker.dev !== expected.dev || marker.ino !== expected.ino)
    throw new Error('partition ownership marker does not match its directory')
}
