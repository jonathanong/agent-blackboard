import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertManifest,
  consumeSnapshotRecord,
  parseSnapshotRecord,
  snapshotLine,
  type SnapshotBlock,
  type SnapshotState,
} from './snapshot-partition-format.mjs'
import { readLines, writeAll } from './snapshot-partition-io.mjs'
import { assertDirectoryIdentity, captureDirectoryIdentity } from './snapshot-artifact-removal.mjs'
import type { SnapshotManifest } from './types.mjs'

export interface StagedSnapshot {
  manifest: SnapshotManifest
  bytes: number
  checksum: string
  index: string
  indexIdentity: { dev: string; ino: string }
}

/** Reads source once through its opened descriptor and stages session groups privately on disk. */
export async function stageSnapshot(
  source: FileHandle,
  directory: string,
): Promise<StagedSnapshot> {
  const directoryIdentity = await captureDirectoryIdentity(directory, 'snapshot staging directory')
  const index = join(directory, 'index.jsonl')
  await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
  const indexFile = await open(index, 'wx', 0o600)
  await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
  const hash = createHash('sha256')
  const state: SnapshotState = { sessions: 0, entries: 0, records: 0 }
  let current: (SnapshotBlock & { file: FileHandle }) | undefined
  let manifest: SnapshotManifest | undefined
  let ordinal = 0
  let bytes = 0
  const finish = async (): Promise<void> => {
    if (!current) return
    await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
    await current.file.sync()
    await current.file.close()
    const { file: _file, ...block } = current
    await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
    await writeAll(indexFile, Buffer.from(snapshotLine(block)))
    await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
    current = undefined
  }
  try {
    for await (const sourceLine of readLines(source, hash, (read) => {
      bytes += read
    })) {
      if (!sourceLine) throw new Error('snapshot contains a blank JSONL record')
      if (manifest) throw new Error('snapshot contains records after its manifest')
      const record = parseSnapshotRecord(sourceLine)
      if (record.type === 'manifest') {
        await finish()
        manifest = record.manifest
        assertManifest(manifest, state)
        continue
      }
      if (record.type === 'session') {
        await finish()
        ordinal += 1
        const path = join(directory, `session-${ordinal}.jsonl`)
        await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
        const file = await open(path, 'wx', 0o600)
        await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
        const identity = await file.stat({ bigint: true })
        current = {
          sessionId: record.session.id as string,
          path,
          identity: { dev: String(identity.dev), ino: String(identity.ino) },
          bytes: 0,
          sessions: 1,
          entries: 0,
          file,
        }
      } else if (!current) throw new Error('snapshot entries must follow their session')
      consumeSnapshotRecord(record, state)
      if (record.type === 'entry') current!.entries += 1
      const bytes = Buffer.from(`${sourceLine}\n`)
      await writeAll(current!.file, bytes)
      current!.bytes += bytes.byteLength
    }
    if (!manifest) throw new Error('snapshot is missing a complete terminal manifest')
    await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
    await indexFile.sync()
    const indexIdentity = await indexFile.stat({ bigint: true })
    await assertDirectoryIdentity(directory, directoryIdentity, 'snapshot staging directory')
    return {
      manifest,
      bytes,
      checksum: hash.digest('hex'),
      index,
      indexIdentity: { dev: String(indexIdentity.dev), ino: String(indexIdentity.ino) },
    }
  } finally {
    /* v8 ignore next -- best-effort closure must not mask parse failure */
    await current?.file.close().catch(() => undefined)
    /* v8 ignore next -- best-effort closure must not mask parse failure */
    await indexFile.close().catch(() => undefined)
  }
}
