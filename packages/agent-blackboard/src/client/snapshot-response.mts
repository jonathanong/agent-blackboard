import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import type { SnapshotManifest, SnapshotSelection } from './types.mjs'

type SnapshotRecord =
  | { type: 'session'; session: unknown }
  | { type: 'entry'; entry: unknown }
  | { type: 'manifest'; manifest: SnapshotManifest }
  | { type: 'error'; error: { code: string } }
type SnapshotState = {
  sessions: number
  entries: number
  records: number
  manifest?: SnapshotManifest
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

async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset)
    /* v8 ignore next -- a successful Node FileHandle write cannot make zero-byte progress */
    if (bytesWritten === 0) throw new Error('could not write snapshot file')
    offset += bytesWritten
  }
}

function validateRecord(record: SnapshotRecord, state: SnapshotState): void {
  if (state.manifest) throw new Error('snapshot contains records after its manifest')
  if (record.type === 'session' && isObject(record.session)) state.sessions += 1
  else if (record.type === 'entry' && isObject(record.entry)) state.entries += 1
  else if (record.type === 'manifest' && isObject(record.manifest)) state.manifest = record.manifest
  else if (record.type === 'error' && typeof record.error?.code === 'string') {
    throw new Error(`snapshot export failed: ${record.error.code}`)
  } else throw new Error('snapshot contains an unsupported record')
  state.records += 1
}

function expectedSelection(
  selection: SnapshotSelection | undefined,
): SnapshotManifest['selection'] {
  return JSON.parse(
    JSON.stringify({ archived: false, ...selection }),
  ) as SnapshotManifest['selection']
}

function validateManifest(
  state: SnapshotState,
  selection: SnapshotSelection | undefined,
): SnapshotManifest {
  const manifest = state.manifest
  if (!manifest || manifest.status !== 'complete' || manifest.schemaVersion !== 1) {
    throw new Error('snapshot is missing a complete terminal manifest')
  }
  if (typeof manifest.createdAt !== 'string' || typeof manifest.completedAt !== 'string') {
    throw new Error('snapshot terminal manifest is invalid')
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
    manifest.ordering?.sessions !== 'createdAt ascending' ||
    manifest.ordering?.entries !== 'createdAt ascending within session' ||
    manifest.consistency !== 'best-effort' ||
    !isDeepStrictEqual(manifest.selection, expectedSelection(selection))
  ) {
    throw new Error('snapshot terminal manifest is invalid')
  }
  return manifest
}

/** Writes and validates snapshot response records, cancelling unfinished failures. */
export async function readSnapshot(
  response: Response,
  file: FileHandle,
  hash: ReturnType<typeof createHash>,
  selection: SnapshotSelection | undefined,
): Promise<{ state: SnapshotState; manifest: SnapshotManifest }> {
  if (!response.body) throw new Error('snapshot response has no body')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const reader = response.body.getReader()
  const state: SnapshotState = { sessions: 0, entries: 0, records: 0 }
  let pending = ''
  let complete = false
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
    if (pending) validateRecord(parseLine(pending), state)
    const manifest = validateManifest(state, selection)
    complete = true
    return { state, manifest }
  } finally {
    try {
      if (!complete) await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}
