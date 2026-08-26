import type { Session, SessionEntry } from '../types.mjs'
import {
  MAX_SESSIONS_LIMIT,
  type BlackboardStore,
  type ListSessionsQuery,
} from '../../store/store.mjs'

const SNAPSHOT_MAX_BYTES = 190 * 1024 * 1024

export interface SnapshotSelection {
  archived: false
  agent?: string
  version?: string
  parentSessionId?: string | null
  data?: Record<string, unknown>
  inactiveForHours?: number
}

interface SnapshotManifest {
  schemaVersion: 1
  status: 'complete'
  createdAt: string
  completedAt: string
  selection: SnapshotSelection
  counts: { sessions: number; entries: number; records: number }
  ordering: { sessions: string; entries: string }
  consistency: 'best-effort'
}

type SnapshotRecord =
  | { type: 'session'; session: Session }
  | { type: 'entry'; entry: SessionEntry }
  | { type: 'manifest'; manifest: SnapshotManifest }
  | { type: 'error'; error: { code: 'snapshot_too_large'; limitBytes: number } }
type Emit = (value: string, reserveError?: boolean) => boolean

function line(record: SnapshotRecord): string {
  return `${JSON.stringify(record)}\n`
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function query(selection: SnapshotSelection, cursor?: string): ListSessionsQuery {
  return { ...selection, limit: MAX_SESSIONS_LIMIT, ...(cursor === undefined ? {} : { cursor }) }
}

async function* sessionBlock(
  store: BlackboardStore,
  credId: string,
  session: Session,
  tooLarge: string,
  emit: Emit,
): AsyncGenerator<string, number | undefined> {
  const sessionLine = line({ type: 'session', session })
  if (!emit(sessionLine, true)) {
    if (emit(tooLarge)) yield tooLarge
    return undefined
  }
  yield sessionLine

  let entries = 0
  for await (const entry of store.getEntries(credId, session.id)) {
    const entryLine = line({ type: 'entry', entry })
    if (!emit(entryLine, true)) {
      yield tooLarge
      return undefined
    }
    entries += 1
    yield entryLine
  }
  return entries
}

async function* snapshotRecords(
  store: BlackboardStore,
  credId: string,
  selection: SnapshotSelection,
  now: () => Date,
  maxBytes: number,
): AsyncGenerator<string> {
  const createdAt = now().toISOString()
  let cursor: string | undefined
  let bytes = 0
  let sessions = 0
  let entries = 0
  let records = 0

  const tooLarge = line({
    type: 'error',
    error: { code: 'snapshot_too_large', limitBytes: maxBytes },
  })
  const emit = (value: string, reserveError = false): boolean => {
    const size = byteLength(value)
    if (bytes + size + (reserveError ? byteLength(tooLarge) : 0) > maxBytes) return false
    bytes += size
    return true
  }

  while (true) {
    const page = await store.listSessions(credId, query(selection, cursor))
    for (const session of page.sessions) {
      const sessionEntries = yield* sessionBlock(store, credId, session, tooLarge, emit)
      if (sessionEntries === undefined) return
      sessions += 1
      entries += sessionEntries
      records += sessionEntries + 1
    }
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }

  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    status: 'complete',
    createdAt,
    completedAt: now().toISOString(),
    selection,
    counts: { sessions, entries, records: records + 1 },
    ordering: {
      sessions: 'createdAt,id ascending',
      entries: 'createdAt ascending within session',
    },
    consistency: 'best-effort',
  }
  const manifestLine = line({ type: 'manifest', manifest })
  if (!emit(manifestLine)) {
    yield tooLarge
    return
  }
  yield manifestLine
}

export function streamSnapshot(
  store: BlackboardStore,
  credId: string,
  selection: SnapshotSelection,
  now: () => Date,
  maxBytes = SNAPSHOT_MAX_BYTES,
): AsyncIterable<string> {
  return snapshotRecords(store, credId, selection, now, maxBytes)
}
