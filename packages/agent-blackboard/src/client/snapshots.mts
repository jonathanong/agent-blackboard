import { createHash, randomUUID } from 'node:crypto'
import { chmod, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { rawRequest } from './http.mjs'
import type {
  ClientConfig,
  SnapshotExportOptions,
  SnapshotExportResult,
  SnapshotManifest,
  SnapshotSelection,
} from './types.mjs'

type File = Awaited<ReturnType<typeof open>>
type SnapshotRecord =
  | { type: 'session'; session: unknown }
  | { type: 'entry'; entry: unknown }
  | { type: 'manifest'; manifest: SnapshotManifest }
  | { type: 'error'; error: { code: string } }

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

function parseLine(line: string): SnapshotRecord {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    throw new Error('snapshot contains invalid JSONL')
  }
  if (!record || typeof record !== 'object' || !('type' in record)) {
    throw new Error('snapshot contains an invalid record')
  }
  return record as SnapshotRecord
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeAll(file: File, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset)
    /* v8 ignore next -- a successful Node FileHandle write cannot make zero-byte progress */
    if (bytesWritten === 0) throw new Error('could not write snapshot file')
    offset += bytesWritten
  }
}

function validateRecord(
  record: SnapshotRecord,
  state: { sessions: number; entries: number; records: number; manifest?: SnapshotManifest },
): void {
  if (state.manifest) throw new Error('snapshot contains records after its manifest')
  if (record.type === 'session' && isObject(record.session)) state.sessions += 1
  else if (record.type === 'entry' && isObject(record.entry)) state.entries += 1
  else if (record.type === 'manifest' && isObject(record.manifest)) state.manifest = record.manifest
  else if (record.type === 'error' && typeof record.error?.code === 'string') {
    throw new Error(`snapshot export failed: ${record.error.code}`)
  } else throw new Error('snapshot contains an unsupported record')
  state.records += 1
}

function validateManifest(
  state: {
    sessions: number
    entries: number
    records: number
    manifest?: SnapshotManifest
  },
  selection: SnapshotSelection | undefined,
): SnapshotManifest {
  const manifest = state.manifest
  if (!manifest || manifest.status !== 'complete' || manifest.schemaVersion !== 1) {
    throw new Error('snapshot is missing a complete terminal manifest')
  }
  const counts = manifest.counts
  if (
    counts.sessions !== state.sessions ||
    counts.entries !== state.entries ||
    counts.records !== state.records
  ) {
    throw new Error('snapshot manifest counts do not match its records')
  }
  if (
    manifest.ordering?.sessions !== 'createdAt,id ascending' ||
    manifest.ordering?.entries !== 'createdAt ascending within session' ||
    manifest.consistency !== 'best-effort' ||
    !isDeepStrictEqual(manifest.selection, { archived: false, ...selection })
  ) {
    throw new Error('snapshot terminal manifest is invalid')
  }
  return manifest
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
      if (!response.body) throw new Error('snapshot response has no body')
      const hash = createHash('sha256')
      const state: {
        sessions: number
        entries: number
        records: number
        manifest?: SnapshotManifest
      } = { sessions: 0, entries: 0, records: 0 }
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const reader = response.body.getReader()
      let pending = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (value) {
            await writeAll(file, value)
            hash.update(value)
            pending += decoder.decode(value, { stream: true })
            const lines = pending.split('\n')
            pending = lines.pop()!
            for (const line of lines) if (line) validateRecord(parseLine(line), state)
          }
          if (done) break
        }
        pending += decoder.decode()
      } finally {
        reader.releaseLock()
      }
      if (pending) validateRecord(parseLine(pending), state)
      const manifest = validateManifest(state, options.selection)
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
