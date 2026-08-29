import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { SnapshotBlock } from './snapshot-partition-format.mjs'
import { writeAll } from './snapshot-partition-io.mjs'

type ExactFileStats = {
  isFile(): boolean
  nlink: bigint
  dev: bigint
  ino: bigint
  size: bigint
}

export type ExactFileIdentity = { dev: bigint; ino: bigint; size: bigint }

export function assertExactFile(
  stats: ExactFileStats,
  expected: ExactFileIdentity,
  message: string,
): void {
  if (
    !stats.isFile() ||
    stats.nlink !== 1n ||
    stats.dev !== expected.dev ||
    stats.ino !== expected.ino ||
    stats.size !== expected.size
  )
    throw new Error(message)
}

export async function copyBlock(
  block: SnapshotBlock,
  output: FileHandle,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const input = await open(block.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let identity: ExactFileIdentity
    try {
      if (!Number.isSafeInteger(block.bytes) || block.bytes < 0)
        throw new Error('staged snapshot block has an invalid size')
      identity = {
        dev: BigInt(block.identity.dev),
        ino: BigInt(block.identity.ino),
        size: BigInt(block.bytes),
      }
    } catch {
      throw new Error('staged snapshot block has an invalid identity')
    }
    const opened = await input.stat({ bigint: true })
    assertExactFile(opened, identity, 'staged snapshot block changed before publication')
    let copied = 0n
    for (;;) {
      const remaining = identity.size - copied
      if (remaining === 0n) {
        const { bytesRead } = await input.read(buffer, 0, 1)
        if (bytesRead) throw new Error('staged snapshot block changed before publication')
        break
      }
      const { bytesRead } = await input.read(
        buffer,
        0,
        Number(remaining > buffer.length ? buffer.length : remaining),
      )
      if (!bytesRead) throw new Error('staged snapshot block changed before publication')
      const bytes = buffer.subarray(0, bytesRead)
      hash.update(bytes)
      await writeAll(output, bytes)
      copied += BigInt(bytesRead)
    }
    const completed = await input.stat({ bigint: true })
    assertExactFile(completed, identity, 'staged snapshot block changed before publication')
  } finally {
    await input.close()
  }
}
