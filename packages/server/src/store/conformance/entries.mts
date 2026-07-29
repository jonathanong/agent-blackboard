import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'
import { collect, createTestSession } from './helpers.mjs'

const SESSION_ID = 's1'

export function runEntriesConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: appendEntry/getEntries', () => {
    it('rejects appendEntry and getEntries for an unknown session', async () => {
      const store = makeStore()
      const credId = randomUUID()
      const missingId = `missing-${randomUUID()}`
      await expect(
        store.appendEntry({ credId, sessionId: missingId, data: {} }),
      ).rejects.toMatchObject({ code: 'session_not_found' })
      await expect(collect(store.getEntries(credId, missingId))).rejects.toMatchObject({
        code: 'session_not_found',
      })
    })

    it('appends to an archived session without changing its archive timestamp', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, SESSION_ID, null)
      const archived = await store.archiveSession(credId, SESSION_ID)
      const appended = await store.appendEntry({ credId, sessionId: SESSION_ID, data: {} })
      await expect(collect(store.getEntries(credId, SESSION_ID))).resolves.toEqual([appended])
      await expect(store.getSession(credId, SESSION_ID)).resolves.toMatchObject({
        archivedAt: archived.archivedAt,
        lastEntryAt: appended.createdAt,
      })
    })

    it('appends entries with distinct createdAt, retrievable in append order', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, SESSION_ID, null)
      const first = await store.appendEntry({ credId, sessionId: SESSION_ID, data: { i: 1 } })
      const second = await store.appendEntry({ credId, sessionId: SESSION_ID, data: { i: 2 } })
      expect(first.createdAt).not.toBe(second.createdAt)
      expect(await collect(store.getEntries(credId, SESSION_ID))).toEqual([first, second])
      await expect(store.getSession(credId, SESSION_ID)).resolves.toMatchObject({
        lastEntryAt: second.createdAt,
      })
    })

    it('scopes entries per credId even when the sessionId literal is reused', async () => {
      const store = makeStore()
      const credA = randomUUID()
      const credB = randomUUID()
      await createTestSession(store, credA, SESSION_ID, null)
      await createTestSession(store, credB, SESSION_ID, null)
      const entryA = await store.appendEntry({
        credId: credA,
        sessionId: SESSION_ID,
        data: { a: 1 },
      })
      const entryB = await store.appendEntry({
        credId: credB,
        sessionId: SESSION_ID,
        data: { b: 2 },
      })
      expect(await collect(store.getEntries(credA, SESSION_ID))).toEqual([entryA])
      expect(await collect(store.getEntries(credB, SESSION_ID))).toEqual([entryB])
    })
  })
}
