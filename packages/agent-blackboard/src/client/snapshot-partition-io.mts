import type { FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const CHUNK_SIZE = 64 * 1024

export async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset)
    /* v8 ignore next -- a successful FileHandle write cannot make zero-byte progress */
    if (bytesWritten === 0) throw new Error('could not write snapshot partition')
    offset += bytesWritten
  }
}

export async function* readLines(
  file: FileHandle,
  hash?: ReturnType<typeof createHash>,
  onRead?: (bytes: number) => void | Promise<void>,
  expectedBytes?: bigint,
  label = 'snapshot',
): AsyncGenerator<string> {
  if (
    expectedBytes !== undefined &&
    (expectedBytes < 0n || expectedBytes > BigInt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error(`${label} has an invalid size`)
  const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  let position = 0
  for (;;) {
    const remaining = expectedBytes === undefined ? undefined : Number(expectedBytes) - position
    if (remaining === 0) {
      const { bytesRead } = await file.read(buffer, 0, 1, position)
      if (bytesRead) throw new Error(`${label} changed during publication`)
      break
    }
    const { bytesRead } = await file.read(
      buffer,
      0,
      Math.min(buffer.byteLength, remaining ?? buffer.byteLength),
      position,
    )
    if (!bytesRead) {
      if (remaining !== undefined) throw new Error(`${label} changed during publication`)
      break
    }
    position += bytesRead
    const bytes = buffer.subarray(0, bytesRead)
    hash?.update(bytes)
    await onRead?.(bytesRead)
    pending += decoder.decode(bytes, { stream: true })
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      yield pending.slice(0, newline)
      pending = pending.slice(newline + 1)
    }
  }
  pending += decoder.decode()
  /* v8 ignore next -- the last chunk normally ends at a record boundary */
  if (pending) yield pending
}
