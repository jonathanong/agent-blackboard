import { createHash } from 'node:crypto'
import type {
  SnapshotChecksum,
  SnapshotCounts,
  SnapshotManifest,
  SnapshotPartitionOptions,
} from './types.mjs'

type Record = {
  type: string
  session?: { id?: unknown }
  entry?: { sessionId?: unknown }
  manifest?: unknown
}
export type SnapshotBlock = {
  sessionId: string
  lines: string[]
  sessions: number
  entries: number
}

export function checksum(bytes: Uint8Array): SnapshotChecksum {
  return { algorithm: 'sha256', value: createHash('sha256').update(bytes).digest('hex') }
}

export function count(blocks: SnapshotBlock[], bytes: number): SnapshotCounts {
  return {
    sessions: blocks.reduce((total, block) => total + block.sessions, 0),
    entries: blocks.reduce((total, block) => total + block.entries, 0),
    records: blocks.reduce((total, block) => total + block.sessions + block.entries, 0) + 1,
    bytes,
  }
}

export function manifestFor(manifest: SnapshotManifest, blocks: SnapshotBlock[]): SnapshotManifest {
  const counts = count(blocks, 0)
  return {
    ...manifest,
    counts: { sessions: counts.sessions, entries: counts.entries, records: counts.records },
  }
}

export function snapshotLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

/** Validates the complete, session-contiguous JSONL contract emitted by snapshot export. */
export function parseSnapshot(bytes: Uint8Array): {
  blocks: SnapshotBlock[]
  manifest: SnapshotManifest
} {
  const blocks: SnapshotBlock[] = []
  let current: SnapshotBlock | undefined
  let manifest: SnapshotManifest | undefined
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n')
  for (const sourceLine of lines) {
    if (!sourceLine) continue
    let record: Record
    try {
      record = JSON.parse(sourceLine) as Record
    } catch {
      throw new Error('snapshot contains invalid JSONL')
    }
    if (manifest) throw new Error('snapshot contains records after its manifest')
    if (record.type === 'session' && typeof record.session?.id === 'string') {
      current = { sessionId: record.session.id, lines: [sourceLine], sessions: 1, entries: 0 }
      blocks.push(current)
    } else if (record.type === 'entry' && typeof record.entry?.sessionId === 'string' && current) {
      if (record.entry.sessionId !== current.sessionId)
        throw new Error('snapshot entries must follow their session')
      current.lines.push(sourceLine)
      current.entries += 1
    } else if (record.type === 'manifest') {
      manifest = record.manifest as SnapshotManifest
    } else throw new Error('snapshot contains an unsupported record')
  }
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.status !== 'complete' ||
    manifest.ordering?.sessions !== 'createdAt ascending' ||
    manifest.ordering?.entries !== 'createdAt ascending within session' ||
    manifest.consistency !== 'best-effort'
  ) {
    throw new Error('snapshot is missing a complete terminal manifest')
  }
  const actual = count(blocks, bytes.byteLength)
  if (
    manifest.counts.sessions !== actual.sessions ||
    manifest.counts.entries !== actual.entries ||
    manifest.counts.records !== actual.records
  ) {
    throw new Error('snapshot manifest counts do not match its records')
  }
  return { blocks, manifest }
}

export function assertVerification(
  bytes: Uint8Array,
  actual: SnapshotCounts,
  options: SnapshotPartitionOptions,
): void {
  if (
    options.checksum &&
    (options.checksum.algorithm !== 'sha256' || options.checksum.value !== checksum(bytes).value)
  ) {
    throw new Error('snapshot checksum does not match')
  }
  if (
    options.counts &&
    Object.entries(options.counts).some(
      ([key, value]) => actual[key as keyof SnapshotCounts] !== value,
    )
  ) {
    throw new Error('snapshot counts do not match')
  }
}
