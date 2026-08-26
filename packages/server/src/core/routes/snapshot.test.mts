import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBlackboardStore } from '../../store/memory.mjs'
import type { BlackboardStore } from '../../store/store.mjs'
import type { HandlerRequest, Session, SessionEntry } from '../types.mjs'
import { closePrefetched, type PrefetchedSession } from './snapshot-prefetch.mjs'
import { handleSnapshotRoute } from './snapshot.mjs'
import { streamSnapshot } from './snapshot-stream.mjs'

const NOW = new Date('2026-01-01T00:00:00.000Z')

async function collect(body: AsyncIterable<string | Uint8Array>): Promise<string> {
  let result = ''
  for await (const chunk of body) result += chunk.toString()
  return result
}

describe('snapshot route', () => {
  let store: MemoryBlackboardStore
  let token: string
  let credId: string

  beforeEach(async () => {
    store = new MemoryBlackboardStore({ now: () => NOW })
    const credential = await store.createCredential('test')
    token = credential.token
    credId = credential.record.id
  })

  function request(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
    return {
      method: 'GET',
      path: '/snapshot',
      query: {},
      headers: { authorization: `Bearer ${token}` },
      ...overrides,
    }
  }

  it('requires a client credential and GET', async () => {
    expect((await handleSnapshotRoute(request({ headers: {} }), store)).status).toBe(401)
    expect((await handleSnapshotRoute(request({ method: 'POST' }), store)).status).toBe(404)
    expect(
      (await handleSnapshotRoute(request({ query: { inactiveForHours: '0' } }), store)).status,
    ).toBe(400)
  })

  it('uses the default clock and preserves an inactivity selection', async () => {
    const response = await handleSnapshotRoute(request({ query: { inactiveForHours: '1' } }), store)
    const records = (await collect(response.body))
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))
    expect(records).toHaveLength(1)
    expect(records[0].manifest.selection).toEqual({ archived: false, inactiveForHours: 1 })
    expect(Number.isNaN(Date.parse(records[0].manifest.createdAt))).toBe(false)
  })

  it('streams session blocks, entries, and a complete manifest while excluding archived sessions', async () => {
    await store.createSession({
      credId,
      id: 'active',
      parentSessionId: null,
      agent: 'luna',
      version: '1',
    })
    await store.createSession({
      credId,
      id: 'archived',
      parentSessionId: null,
      agent: 'terra',
      version: '1',
    })
    await store.appendEntry({ credId, sessionId: 'active', data: { type: 'retrospective' } })
    await store.archiveSession(credId, 'archived')

    const response = await handleSnapshotRoute(request(), store, () => NOW)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/x-ndjson')
    const records = (await collect(response.body))
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))

    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({ type: 'session', session: { id: 'active' } })
    expect(records[1]).toMatchObject({ type: 'entry', entry: { sessionId: 'active' } })
    expect(records[2]).toEqual({
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt: NOW.toISOString(),
        completedAt: NOW.toISOString(),
        selection: { archived: false },
        counts: { sessions: 1, entries: 1, records: 3 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    })
  })

  it('applies supported filters', async () => {
    await store.createSession({
      credId,
      id: 'wrong',
      parentSessionId: null,
      agent: 'terra',
      version: '1',
    })
    await store.createSession({
      credId,
      id: 'match',
      parentSessionId: null,
      agent: 'luna',
      version: '2',
    })
    await store.patchSession(credId, { sessionId: 'match', data: { branch: 'main' } })
    const response = await handleSnapshotRoute(
      request({
        query: {
          agent: 'luna',
          version: '2',
          parentSessionId: '',
          data: JSON.stringify({ branch: 'main' }),
        },
      }),
      store,
      () => new Date('2026-01-02T00:00:00.000Z'),
    )
    const records = (await collect(response.body))
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))
    expect(records[0].session.id).toBe('match')
    expect(records.at(-1).manifest.selection).toEqual({
      archived: false,
      agent: 'luna',
      version: '2',
      parentSessionId: null,
      data: { branch: 'main' },
    })
  })

  it('skips a session that was archived after an eventually consistent listing', async () => {
    const active = await store.createSession({
      credId,
      id: 'archived-after-list',
      parentSessionId: null,
      agent: 'luna',
      version: '1',
    })
    await store.archiveSession(credId, active.id)
    vi.spyOn(store, 'listSessions').mockResolvedValueOnce({
      sessions: [active],
      nextCursor: null,
    })

    const records = (await collect(streamSnapshot(store, credId, { archived: false }, () => NOW)))
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))

    expect(records).toHaveLength(1)
    expect(records[0].manifest.counts).toEqual({ sessions: 0, entries: 0, records: 1 })
  })

  it('prefetches bounded first entries concurrently while keeping session groups ordered', async () => {
    const sessions: Session[] = Array.from({ length: 9 }, (_, index) => ({
      id: `session-${index}`,
      parentSessionId: null,
      agent: 'luna',
      version: '1',
      createdAt: NOW.toISOString(),
      lastEntryAt: null,
      archivedAt: null,
      data: {},
    }))
    const initialIds = sessions.slice(0, 8).map(({ id }) => id)
    const started: string[] = []
    let release = (): void => undefined
    const firstReads = new Promise<void>((resolve) => {
      release = resolve
    })
    const fakeStore = {
      listSessions: async () => ({ sessions, nextCursor: null }),
      getSession: async (_credId: string, sessionId: string) =>
        sessions.find(({ id }) => id === sessionId),
      getEntries: (_credId: string, sessionId: string): AsyncIterable<SessionEntry> =>
        (async function* (): AsyncGenerator<SessionEntry> {
          started.push(sessionId)
          if (started.length === initialIds.length) release()
          await firstReads
          if (sessionId === initialIds[0]) expect(started).toEqual(initialIds)
          yield { sessionId, createdAt: NOW.toISOString(), data: {} }
        })(),
    } as unknown as BlackboardStore

    const records = (
      await collect(streamSnapshot(fakeStore, 'cred', { archived: false }, () => NOW))
    )
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))

    expect(records.filter(({ type }) => type !== 'manifest')).toEqual(
      sessions.flatMap(({ id }) => [
        expect.objectContaining({ type: 'session', session: expect.objectContaining({ id }) }),
        expect.objectContaining({
          type: 'entry',
          entry: expect.objectContaining({ sessionId: id }),
        }),
      ]),
    )
    expect(started).toEqual(sessions.map(({ id }) => id))
  })

  it('closes prefetched iterators only when they support early return', async () => {
    const session = await store.createSession({
      credId,
      id: 'prefetched',
      parentSessionId: null,
      agent: 'luna',
      version: '1',
    })
    const close = vi.fn(async () => ({ done: true, value: undefined }) as const)
    const first = { done: true, value: undefined } as const
    const iterator = { next: async () => first }
    const prefetched: PrefetchedSession[] = [
      { session, entries: iterator, first },
      { session, entries: { ...iterator, return: close }, first },
    ]

    await closePrefetched(prefetched)

    expect(close).toHaveBeenCalledOnce()
  })

  it('continues after an empty filtered page while the cursor is non-null', async () => {
    for (let index = 0; index <= 200; index += 1) {
      const id = `session-${String(index).padStart(3, '0')}`
      await store.createSession({
        credId,
        id,
        parentSessionId: null,
        agent: 'luna',
        version: '1',
      })
      if (index < 200) await store.archiveSession(credId, id)
    }

    const response = await handleSnapshotRoute(request(), store, () => NOW)
    const records = (await collect(response.body))
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))

    expect(records[0]).toMatchObject({
      type: 'session',
      session: { id: 'session-200' },
    })
    expect(records.at(-1).manifest.counts).toEqual({ sessions: 1, entries: 0, records: 2 })
  })

  it('emits a terminal size error without a completion manifest', async () => {
    await store.createSession({
      credId,
      id: 'large',
      parentSessionId: null,
      agent: 'luna',
      version: '1',
    })
    const records = (
      await collect(streamSnapshot(store, credId, { archived: false }, () => NOW, 300))
    )
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))
    expect(records.at(-1)).toEqual({
      type: 'error',
      error: { code: 'snapshot_too_large', limitBytes: 300 },
    })
    expect(records.some((record) => record.type === 'manifest')).toBe(false)
  })

  it('reports a size error before a session or entry that cannot fit', async () => {
    await store.createSession({
      credId,
      id: 'large',
      parentSessionId: null,
      agent: 'luna',
      version: '1',
    })

    const beforeSession = await collect(
      streamSnapshot(store, credId, { archived: false }, () => NOW, 100),
    )
    expect(JSON.parse(beforeSession).error.code).toBe('snapshot_too_large')

    await store.appendEntry({
      credId,
      sessionId: 'large',
      data: { payload: 'x'.repeat(2_000) },
    })
    const beforeEntry = (
      await collect(streamSnapshot(store, credId, { archived: false }, () => NOW, 1_000))
    )
      .trim()
      .split('\n')
      .map((value) => JSON.parse(value))
    expect(beforeEntry.map((record) => record.type)).toEqual(['session', 'error'])

    expect(await collect(streamSnapshot(store, credId, { archived: false }, () => NOW, 1))).toBe('')
  })
})
