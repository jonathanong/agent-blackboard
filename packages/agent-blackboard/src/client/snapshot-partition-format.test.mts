import { expect, it } from 'vitest'
import {
  assertManifest,
  consumeSnapshotRecord,
  parseSnapshotRecord,
  type SnapshotState,
} from './snapshot-partition-format.mjs'
import type { SnapshotManifest } from './types.mjs'

const manifest: SnapshotManifest = {
  schemaVersion: 1,
  status: 'complete',
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  selection: { archived: false },
  counts: { sessions: 1, entries: 1, records: 3 },
  ordering: { sessions: 'createdAt ascending', entries: 'createdAt ascending within session' },
  consistency: 'best-effort',
}

function state(): SnapshotState {
  return { sessions: 1, entries: 1, records: 2, currentSessionId: 's' }
}

it('strictly validates snapshot record and terminal manifest shapes', () => {
  expect(() => parseSnapshotRecord('{')).toThrow('invalid JSONL')
  expect(() => parseSnapshotRecord('null')).toThrow('invalid record')
  for (const record of [
    { type: 'session', session: { id: 's' } },
    {
      type: 'session',
      session: {
        id: 's',
        parentSessionId: null,
        agent: 'agent',
        version: '1',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastEntryAt: null,
        archivedAt: 'not-null',
        data: {},
      },
    },
    { type: 'entry', entry: { sessionId: 's' } },
    {
      type: 'session',
      session: {
        id: 'bad/id',
        parentSessionId: null,
        agent: 'agent',
        version: '1',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastEntryAt: null,
        archivedAt: null,
        data: {},
      },
    },
    {
      type: 'entry',
      entry: { sessionId: 'bad id', createdAt: '2026-01-01T00:00:00.000Z', data: {} },
    },
    { type: 'manifest', manifest: [] },
  ]) {
    expect(() => parseSnapshotRecord(JSON.stringify(record))).toThrow('unsupported')
  }
  for (const change of [
    { selection: { archived: true } },
    { selection: { archived: false, agent: 1 } },
    { selection: { archived: false, version: 1 } },
    { selection: { archived: false, parentSessionId: 1 } },
    { selection: { archived: false, parentSessionId: 'bad/id' } },
    { selection: { archived: false, data: [] } },
    { selection: { archived: false, inactiveForHours: 0 } },
    { createdAt: 'bad' },
    { counts: { sessions: -1, entries: 1, records: 3 } },
    { ordering: { sessions: 'wrong', entries: 'createdAt ascending within session' } },
    { consistency: 'wrong' },
  ]) {
    expect(() => assertManifest({ ...manifest, ...change } as SnapshotManifest, state())).toThrow(
      'complete terminal manifest',
    )
  }
  expect(() =>
    assertManifest({ ...manifest, counts: { sessions: 1, entries: 1, records: 2 } }, state()),
  ).toThrow('counts')
  expect(() => assertManifest(manifest, state())).not.toThrow()
})

it('requires contiguous ordered session and entry records', () => {
  const session = parseSnapshotRecord(
    JSON.stringify({
      type: 'session',
      session: {
        id: 's',
        parentSessionId: null,
        agent: 'agent',
        version: '1',
        createdAt: '2026-01-02T00:00:00.000Z',
        lastEntryAt: null,
        archivedAt: null,
        data: {},
      },
    }),
  )
  const entry = parseSnapshotRecord(
    JSON.stringify({
      type: 'entry',
      entry: { sessionId: 's', createdAt: '2026-01-02T00:00:00.000Z', data: {} },
    }),
  )
  if (session.type !== 'session' || entry.type !== 'entry')
    throw new Error('fixture record mismatch')
  const checked: SnapshotState = { sessions: 0, entries: 0, records: 0 }
  consumeSnapshotRecord({ type: 'manifest', manifest }, checked)
  consumeSnapshotRecord(session, checked)
  consumeSnapshotRecord(entry, checked)
  expect(() =>
    consumeSnapshotRecord(
      { ...session, session: { ...session.session, createdAt: '2026-01-01T00:00:00.000Z' } },
      checked,
    ),
  ).toThrow('sessions are not ordered')
  expect(() =>
    consumeSnapshotRecord({ ...entry, entry: { ...entry.entry, sessionId: 'other' } }, checked),
  ).toThrow('must follow')
  expect(() =>
    consumeSnapshotRecord(
      { ...entry, entry: { ...entry.entry, createdAt: '2026-01-01T00:00:00.000Z' } },
      checked,
    ),
  ).toThrow('entries are not ordered')
  expect(() =>
    consumeSnapshotRecord(
      { ...session, session: { ...session.session, createdAt: '2026-01-02T00:30:00+02:00' } },
      checked,
    ),
  ).toThrow('sessions are not ordered')
  const laterEntryState: SnapshotState = {
    sessions: 1,
    entries: 1,
    records: 2,
    currentSessionId: 's',
    lastEntryCreatedAt: Date.parse('2026-01-02T00:00:00Z'),
  }
  expect(() =>
    consumeSnapshotRecord(
      { ...entry, entry: { ...entry.entry, createdAt: '2026-01-02T00:30:00+02:00' } },
      laterEntryState,
    ),
  ).toThrow('entries are not ordered')
})
