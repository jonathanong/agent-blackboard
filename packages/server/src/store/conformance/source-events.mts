import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'
import { collect, createTestSession } from './helpers.mjs'

export function runSourceEventsConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: sourceEventId deduplication and conflict', () => {
    it('stores a new entry, returns duplicates without re-writing, and rejects conflicting payloads', async () => {
      const store = makeStore()
      const credId = randomUUID()
      const sessionA = `se-a-${randomUUID()}`
      const sessionB = `se-b-${randomUUID()}`
      await createTestSession(store, credId, sessionA, null)
      await createTestSession(store, credId, sessionB, null)

      // 1. New entry with sourceEventId
      const created = await store.appendEntry({
        credId,
        sessionId: sessionA,
        data: { b: 2, a: 1 },
        sourceEventId: 'evt-1',
      })
      expect(created.sourceEventId).toBe('evt-1')
      expect(created.duplicate).toBeUndefined()
      const expectedCreated = structuredClone(created)
      // Mutating the caller's returned object must not corrupt stored duplicate reads
      created.data.a = 999

      // 2. Duplicate with semantically identical content (different key order) returns stored entry
      const duplicate = await store.appendEntry({
        credId,
        sessionId: sessionA,
        data: { a: 1, b: 2 },
        sourceEventId: 'evt-1',
      })
      expect(duplicate).toEqual({ ...expectedCreated, duplicate: true })
      expect(await collect(store.getEntries(credId, sessionA))).toEqual([expectedCreated])

      // 3. Conflict with same sourceEventId and different content throws 409-mapped error naming stored entry
      await expect(
        store.appendEntry({
          credId,
          sessionId: sessionA,
          data: { a: 1, b: 999 },
          sourceEventId: 'evt-1',
        }),
      ).rejects.toMatchObject({
        code: 'source_event_conflict',
        details: {
          existingEntry: {
            sessionId: sessionA,
            createdAt: created.createdAt,
            sourceEventId: 'evt-1',
          },
        },
      })

      // Uniqueness is scoped per session
      const inOtherSession = await store.appendEntry({
        credId,
        sessionId: sessionB,
        data: { different: true },
        sourceEventId: 'evt-1',
      })
      expect(inOtherSession.duplicate).toBeUndefined()
      expect(inOtherSession.sourceEventId).toBe('evt-1')
    })
  })
}
