import { createHash, randomUUID } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { rawRequest } from './http.mjs'
import { readSnapshot } from './snapshot-response.mjs'
import { cleanupSnapshotPartitions } from './snapshot-partition-cleanup.mjs'
import { partitionSnapshot } from './snapshot-partitions.mjs'
import { removeOwnedFile, type Identity } from './snapshot-artifact-removal.mjs'
import {
  createCleanupToken,
  snapshotMarkerPath,
  writeSnapshotMarker,
} from './snapshot-artifact-ownership.mjs'
import type {
  ClientConfig,
  SnapshotExportOptions,
  SnapshotExportResult,
  SnapshotSelection,
  SnapshotCleanupOptions,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
} from './types.mjs'

type File = Awaited<ReturnType<typeof open>>

function queryFor(selection: SnapshotSelection = {}): Record<string, string> {
  const query: Record<string, string> = {}
  if (selection.agent !== undefined) query.agent = selection.agent
  if (selection.version !== undefined) query.version = selection.version
  if (selection.parentSessionId !== undefined)
    query.parentSessionId = selection.parentSessionId ?? ''
  if (selection.data !== undefined) query.data = JSON.stringify(selection.data)
  if (selection.inactiveForHours !== undefined)
    query.inactiveForHours = String(selection.inactiveForHours)
  return query
}

async function createDestination(path: string | undefined): Promise<{
  path: string
  file: File
  identity: Identity
  cleanupToken?: string
}> {
  if (path !== undefined) {
    if (!isAbsolute(path)) throw new Error('snapshot path must be absolute')
    try {
      const file = await open(path, 'wx', 0o600)
      const identity = await file.stat({ bigint: true })
      return { path, file, identity: { dev: identity.dev, ino: identity.ino } }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`snapshot path already exists: ${path}`)
      }
      throw error
    }
  }
  const generated = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  const cleanupToken = createCleanupToken()
  const file = await open(generated, 'wx', 0o600)
  const identity = await file.stat({ bigint: true })
  try {
    await writeSnapshotMarker(generated, file, cleanupToken)
    return {
      path: generated,
      file,
      identity: { dev: identity.dev, ino: identity.ino },
      cleanupToken,
    }
  } catch (error) {
    /* v8 ignore start -- ownership-marker creation can fail only through an OS-level collision or fault */
    await file.close().catch(() => undefined)
    await removeOwnedFile(generated, 'snapshot path', {
      dev: identity.dev,
      ino: identity.ino,
    }).catch(() => undefined)
    const marker = await lstat(snapshotMarkerPath(generated), { bigint: true }).catch(
      () => undefined,
    )
    if (marker) {
      await removeOwnedFile(snapshotMarkerPath(generated), 'snapshot ownership marker', {
        dev: marker.dev,
        ino: marker.ino,
      }).catch(() => undefined)
    }
    /* v8 ignore stop */
    /* v8 ignore next -- preserve the primary marker-creation failure */
    throw error
  }
}

/** Streams an immutable server snapshot directly into a private local JSONL file. */
export class Snapshots {
  readonly #config: ClientConfig

  constructor(config: ClientConfig) {
    this.#config = config
  }

  async export(options: SnapshotExportOptions = {}): Promise<SnapshotExportResult> {
    const target = await createDestination(options.path)
    let file: File | undefined = target.file
    let complete = false
    try {
      const response = await rawRequest(this.#config, '/snapshot', {
        method: 'GET',
        headers: { accept: 'application/x-ndjson' },
        query: queryFor(options.selection),
      })
      const hash = createHash('sha256')
      const { state, manifest } = await readSnapshot(response, file, hash, options.selection)
      const info = await file.stat()
      await file.sync()
      await file.chmod(0o400)
      await file.close()
      file = undefined
      complete = true
      return {
        path: target.path,
        counts: {
          sessions: state.sessions,
          entries: state.entries,
          records: state.records,
          bytes: info.size,
        },
        checksum: { algorithm: 'sha256', value: hash.digest('hex') },
        manifest,
        ...(target.cleanupToken === undefined ? {} : { cleanupToken: target.cleanupToken }),
      }
    } finally {
      /* v8 ignore next -- cleanup must still remove partial output if close itself fails */
      if (file) await file.close().catch(() => undefined)
      if (!complete) {
        /* v8 ignore next -- best-effort cleanup must not mask the original export failure */
        await removeOwnedFile(target.path, 'snapshot path', target.identity).catch(() => undefined)
        /* v8 ignore next -- best-effort marker cleanup must not mask the original export failure */
        if (target.cleanupToken !== undefined) {
          const marker = await lstat(snapshotMarkerPath(target.path), { bigint: true }).catch(
            () => undefined,
          )
          if (marker)
            await removeOwnedFile(snapshotMarkerPath(target.path), 'snapshot ownership marker', {
              dev: marker.dev,
              ino: marker.ino,
            }).catch(() => undefined)
        }
      }
    }
  }

  /** Splits a generated export into bounded session-preserving files. */
  partition(options: SnapshotPartitionOptions): Promise<SnapshotPartitionResult> {
    return partitionSnapshot(options)
  }

  /** Removes a generated partition directory. */
  cleanup(options: SnapshotCleanupOptions): Promise<void> {
    return cleanupSnapshotPartitions(options)
  }
}
