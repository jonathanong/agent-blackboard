import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { SnapshotBlock } from './snapshot-partition-format.mjs'
import { writeAll } from './snapshot-partition-io.mjs'

export async function copyBlock(
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
      opened.nlink !== 1n ||
      opened.dev !== identity.dev ||
      opened.ino !== identity.ino
    )
      throw new Error('staged snapshot block changed before publication')
    /* v8 ignore stop */
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
