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
import type { SnapshotManifest, SnapshotPartition } from './types.mjs'

async function copyBlock(
  block: SnapshotBlock,
  output: FileHandle,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const input = await open(block.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let identity: { dev: bigint; ino: bigint }
    try {
      identity = { dev: BigInt(block.identity.dev), ino: BigInt(block.identity.ino) }
    } catch {
      throw new Error('staged snapshot block has an invalid identity')
    }
    const opened = await input.stat({ bigint: true })
    /* v8 ignore start -- a staged output replacement between identity checks is race-only */
    if (
      !opened.isFile() ||
      opened.isSymbolicLink() ||
      opened.nlink !== 1n ||
      opened.dev !== identity.dev ||
      opened.ino !== identity.ino
    )
      throw new Error('staged snapshot block changed before publication')
    for (;;) {
      const { bytesRead } = await input.read(buffer)
      if (!bytesRead) return
      const bytes = buffer.subarray(0, bytesRead)
      hash.update(bytes)
      await writeAll(output, bytes)
    }
  } finally {
    await input.close()
  }
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
  indexIdentity: { dev: string; ino: string },
  manifest: SnapshotManifest,
  directory: string,
  maxSessions: number,
  maxBytes: number,
): Promise<SnapshotPartition[]> {
  const partitions: SnapshotPartition[] = []
  const indexFile = await open(index, constants.O_RDONLY | constants.O_NOFOLLOW)
  let expectedIndex
  try {
    expectedIndex = { dev: BigInt(indexIdentity.dev), ino: BigInt(indexIdentity.ino) }
  } catch {
    await indexFile.close()
    throw new Error('staged snapshot index has an invalid identity')
  }
  const openedIndex = await indexFile.stat({ bigint: true })
  if (
    !openedIndex.isFile() ||
    openedIndex.isSymbolicLink() ||
    openedIndex.nlink !== 1n ||
    openedIndex.dev !== expectedIndex.dev ||
    openedIndex.ino !== expectedIndex.ino
  ) {
    await indexFile.close()
    throw new Error('staged snapshot index changed before publication')
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
    active = {
      block: {
        sessionId: '',
        path: '',
        identity: { dev: '', ino: '' },
        bytes: 0,
        sessions: 0,
        entries: 0,
      },
      file: await open(temporary, 'wx', 0o600),
      temporary,
      hash: createHash('sha256'),
    }
    return active
  }
  const finish = async (): Promise<void> => {
    if (!active) return
    const partitionManifest = manifestFor(manifest, active.block)
    const terminal = Buffer.from(snapshotLine({ type: 'manifest', manifest: partitionManifest }))
    await writeAll(active.file, terminal)
    active.hash.update(terminal)
    await active.file.sync()
    await active.file.chmod(0o400)
    const temporaryIdentity = await active.file.stat({ bigint: true })
    await active.file.close()
    const temporary = await lstat(active.temporary, { bigint: true })
    if (
      !temporary.isFile() ||
      temporary.isSymbolicLink() ||
      temporary.nlink !== 1n ||
      temporary.dev !== temporaryIdentity.dev ||
      temporary.ino !== temporaryIdentity.ino
    )
      throw new Error('staged partition changed before publication')
    const path = join(directory, `partition-${partitions.length + 1}.jsonl`)
    await rename(active.temporary, path)
    const published = await lstat(path, { bigint: true })
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      published.nlink !== 1n ||
      published.dev !== temporaryIdentity.dev ||
      published.ino !== temporaryIdentity.ino
    )
      throw new Error('partition changed during publication')
    /* v8 ignore stop */
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
    for await (const sourceLine of readLines(indexFile)) {
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
    }
    await finish()
    return partitions
  } finally {
    await indexFile.close()
    /* v8 ignore next -- best-effort closure must not mask an assembly failure */
    await active?.file.close().catch(() => undefined)
  }
}
