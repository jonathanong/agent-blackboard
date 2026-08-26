import { createHash, randomUUID } from 'node:crypto'
import { chmod, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { rawRequest } from './http.mjs'
import { readSnapshot } from './snapshot-response.mjs'
import type {
  ClientConfig,
  SnapshotExportOptions,
  SnapshotExportResult,
  SnapshotSelection,
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

async function createDestination(path: string | undefined): Promise<{ path: string; file: File }> {
  if (path !== undefined) {
    if (!isAbsolute(path)) throw new Error('snapshot path must be absolute')
    try {
      return { path, file: await open(path, 'wx', 0o600) }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`snapshot path already exists: ${path}`)
      }
      throw error
    }
  }
  const generated = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  return { path: generated, file: await open(generated, 'wx', 0o600) }
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
      await file.close()
      file = undefined
      await chmod(target.path, 0o400)
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
      }
    } finally {
      /* v8 ignore next -- cleanup must still remove partial output if close itself fails */
      if (file) await file.close().catch(() => undefined)
      if (!complete) await rm(target.path, { force: true })
    }
  }
}
