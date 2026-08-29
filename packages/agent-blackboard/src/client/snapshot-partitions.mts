import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  assertVerification,
  checksum,
  count,
  manifestFor,
  parseSnapshot,
  snapshotLine as line,
  type SnapshotBlock as Block,
} from './snapshot-partition-format.mjs'
import type {
  SnapshotCleanupOptions,
  SnapshotManifest,
  SnapshotPartition,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
} from './types.mjs'

const MAX_SESSIONS = 25
const MAX_BYTES = 1024 * 1024
const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const DIRECTORY_NAME = /^agent-blackboard-partitions-[A-Za-z0-9]+$/

function assertLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error(`${label} must be a positive integer`)
  return limit
}

async function assertGenerated(
  path: string,
  expression: RegExp,
  label: string,
  kind: string,
): Promise<void> {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute generated temporary path`)
  const resolved = await realpath(path)
  const temporary = await realpath(tmpdir())
  if (dirname(resolved) !== temporary || !expression.test(basename(resolved))) {
    throw new Error(`${label} must be a generated temporary ${kind}`)
  }
}

function assertGeneratedDirectoryPath(directory: string): void {
  if (
    !isAbsolute(directory) ||
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !DIRECTORY_NAME.test(basename(directory))
  ) {
    throw new Error('partition directory must be a generated temporary partition directory')
  }
}

function groups(
  blocks: Block[],
  manifest: SnapshotManifest,
  maxSessions: number,
  maxBytes: number,
): Block[][] {
  const result: Block[][] = []
  let group: Block[] = []
  for (const block of blocks) {
    const candidate = [...group, block]
    const candidateBytes = Buffer.byteLength(
      `${candidate.flatMap((item) => item.lines).join('\n')}\n${line({ type: 'manifest', manifest: manifestFor(manifest, candidate) })}`,
    )
    if (candidateBytes > maxBytes) {
      if (group.length === 0)
        throw new Error(`snapshot session ${block.sessionId} is too large for one partition`)
      result.push(group)
      group = [block]
      const singleBytes = Buffer.byteLength(
        `${block.lines.join('\n')}\n${line({ type: 'manifest', manifest: manifestFor(manifest, group) })}`,
      )
      if (singleBytes > maxBytes)
        throw new Error(`snapshot session ${block.sessionId} is too large for one partition`)
    } else group = candidate
    if (group.length === maxSessions) {
      result.push(group)
      group = []
    }
  }
  if (group.length > 0) result.push(group)
  return result
}

/** Splits a generated snapshot into bounded, whole-session, read-only JSONL files. */
export async function partitionSnapshot(
  options: SnapshotPartitionOptions,
): Promise<SnapshotPartitionResult> {
  await assertGenerated(options.path, SOURCE_NAME, 'snapshot path', 'snapshot')
  const bytes = await readFile(options.path)
  const { blocks, manifest } = parseSnapshot(bytes)
  const sourceCounts = count(blocks, bytes.byteLength)
  assertVerification(bytes, sourceCounts, options)
  const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
  await chmod(directory, 0o700)
  try {
    const partitions: SnapshotPartition[] = []
    for (const [index, group] of groups(
      blocks,
      manifest,
      assertLimit(options.maxSessions, MAX_SESSIONS, 'maxSessions'),
      assertLimit(options.maxBytes, MAX_BYTES, 'maxBytes'),
    ).entries()) {
      const partitionManifest = manifestFor(manifest, group)
      const output = Buffer.from(
        `${group.flatMap((block) => block.lines).join('\n')}\n${line({ type: 'manifest', manifest: partitionManifest })}`,
      )
      const path = join(directory, `partition-${index + 1}.jsonl`)
      await writeFile(path, output, { mode: 0o400, flag: 'wx' })
      await chmod(path, 0o400)
      partitions.push({
        path,
        counts: count(group, output.byteLength),
        checksum: checksum(output),
        manifest: partitionManifest,
      })
    }
    return { directory, partitions }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/** Removes a generated partition directory, refusing arbitrary filesystem paths. */
export async function cleanupSnapshotPartitions(options: SnapshotCleanupOptions): Promise<void> {
  assertGeneratedDirectoryPath(options.directory)
  try {
    await assertGenerated(
      options.directory,
      DIRECTORY_NAME,
      'partition directory',
      'partition directory',
    )
    if (!(await stat(options.directory)).isDirectory())
      throw new Error('partition directory is not a directory')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await rm(options.directory, { recursive: true, force: true })
}
