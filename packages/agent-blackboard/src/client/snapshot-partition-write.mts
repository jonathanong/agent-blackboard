import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, rename } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  countsFor,
  manifestFor,
  snapshotLine,
  type SnapshotBlock,
} from './snapshot-partition-format.mjs'
import { readLines, writeAll } from './snapshot-partition-io.mjs'
import { assertDirectoryIdentity, captureDirectoryIdentity } from './snapshot-artifact-removal.mjs'
import { assertExactFile, copyBlock } from './snapshot-partition-copy.mjs'
import type { SnapshotManifest, SnapshotPartition } from './types.mjs'

type PartitionFileStats = {
  isFile(): boolean
  nlink: bigint
  dev: bigint
  ino: bigint
}

export function assertPartitionFile(
  stats: PartitionFileStats,
  expected: { dev: bigint; ino: bigint },
  message: string,
): void {
  if (
    !stats.isFile() ||
    stats.nlink !== 1n ||
    stats.dev !== expected.dev ||
    stats.ino !== expected.ino
  )
    throw new Error(message)
}

const STAGED_BLOCK_NAME = /^session-[1-9][0-9]*\.jsonl$/

function assertStagedBlockPath(block: SnapshotBlock, index: string): void {
  if (
    !isAbsolute(block.path) ||
    dirname(resolve(block.path)) !== dirname(resolve(index)) ||
    !STAGED_BLOCK_NAME.test(basename(block.path))
  )
    throw new Error('staged snapshot block path is invalid')
}

/** Replays private staged groups into bounded, immutable partition files. */
export async function writePartitions(
  index: string,
  indexIdentity: { dev: string; ino: string; size: string },
  manifest: SnapshotManifest,
  directory: string,
  maxSessions: number,
  maxBytes: number,
): Promise<SnapshotPartition[]> {
  const partitions: SnapshotPartition[] = []
  const stageDirectory = dirname(index)
  const stageIdentity = await captureDirectoryIdentity(stageDirectory, 'staging directory')
  const outputIdentity = await captureDirectoryIdentity(directory, 'output directory')
  const assertStage = () =>
    assertDirectoryIdentity(stageDirectory, stageIdentity, 'staging directory')
  const assertOutput = () => assertDirectoryIdentity(directory, outputIdentity, 'output directory')
  await assertStage()
  await assertOutput()
  const indexFile = await open(index, constants.O_RDONLY | constants.O_NOFOLLOW)
  await assertStage()
  let expectedIndex
  try {
    expectedIndex = {
      dev: BigInt(indexIdentity.dev),
      ino: BigInt(indexIdentity.ino),
      size: BigInt(indexIdentity.size),
    }
    if (expectedIndex.size < 0n || expectedIndex.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('staged snapshot index has an invalid identity')
  } catch {
    await indexFile.close()
    throw new Error('staged snapshot index has an invalid identity')
  }
  const openedIndex = await indexFile.stat({ bigint: true })
  try {
    assertExactFile(openedIndex, expectedIndex, 'staged snapshot index changed before publication')
  } catch (error) {
    await indexFile.close()
    throw error
  }
  let active:
    | {
        block: SnapshotBlock
        file: FileHandle
        temporary: string
        hash: ReturnType<typeof createHash>
      }
    | undefined
  const start = async (): Promise<NonNullable<typeof active>> => {
    const number = partitions.length + 1
    const temporary = join(directory, `.partition-${number}.tmp`)
    await assertOutput()
    const file = await open(temporary, 'wx', 0o600)
    active = {
      block: {
        sessionId: '',
        path: '',
        identity: { dev: '', ino: '' },
        bytes: 0,
        sessions: 0,
        entries: 0,
      },
      file,
      temporary,
      hash: createHash('sha256'),
    }
    await assertOutput()
    return active
  }
  const finish = async (): Promise<void> => {
    if (!active) return
    const partitionManifest = manifestFor(manifest, active.block)
    const terminal = Buffer.from(snapshotLine({ type: 'manifest', manifest: partitionManifest }))
    await assertOutput()
    await writeAll(active.file, terminal)
    active.hash.update(terminal)
    await active.file.sync()
    await active.file.chmod(0o400)
    await assertOutput()
    const temporaryIdentity = await active.file.stat({ bigint: true })
    await active.file.close()
    const temporary = await lstat(active.temporary, { bigint: true })
    assertPartitionFile(temporary, temporaryIdentity, 'staged partition changed before publication')
    const path = join(directory, `partition-${partitions.length + 1}.jsonl`)
    await assertOutput()
    await rename(active.temporary, path)
    const published = await lstat(path, { bigint: true })
    assertPartitionFile(published, temporaryIdentity, 'partition changed during publication')
    await assertOutput()
    const bytes = active.block.bytes + terminal.byteLength
    partitions.push({
      path,
      counts: countsFor(active.block, bytes),
      checksum: { algorithm: 'sha256', value: active.hash.digest('hex') },
      manifest: partitionManifest,
    })
    active = undefined
  }
  try {
    for await (const sourceLine of readLines(
      indexFile,
      undefined,
      undefined,
      expectedIndex.size,
      'staged snapshot index',
    )) {
      await assertStage()
      const block = JSON.parse(sourceLine) as SnapshotBlock
      assertStagedBlockPath(block, index)
      if (active && active.block.sessions + block.sessions > maxSessions) await finish()
      let candidate = {
        ...block,
        sessions: (active?.block.sessions ?? 0) + block.sessions,
        entries: (active?.block.entries ?? 0) + block.entries,
      }
      let terminalBytes = Buffer.byteLength(
        snapshotLine({ type: 'manifest', manifest: manifestFor(manifest, candidate) }),
      )
      if (active && active.block.bytes + block.bytes + terminalBytes > maxBytes) {
        await finish()
        candidate = { ...block }
        terminalBytes = Buffer.byteLength(
          snapshotLine({ type: 'manifest', manifest: manifestFor(manifest, candidate) }),
        )
      }
      if (block.bytes + terminalBytes > maxBytes)
        throw new Error(`snapshot session ${block.sessionId} is too large for one partition`)
      const target = active ?? (await start())
      target.block.sessions += block.sessions
      target.block.entries += block.entries
      target.block.bytes += block.bytes
      await copyBlock(block, target.file, target.hash)
      await assertStage()
    }
    const completedIndex = await indexFile.stat({ bigint: true })
    assertExactFile(
      completedIndex,
      expectedIndex,
      'staged snapshot index changed before publication',
    )
    await finish()
    await assertStage()
    await assertOutput()
    return partitions
  } finally {
    await indexFile.close()
    /* v8 ignore next -- best-effort closure must not mask an assembly failure */
    await active?.file.close().catch(() => undefined)
  }
}
