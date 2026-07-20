import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'
import { createTestSession, expectValidTimestamp } from './helpers.mjs'

const SESSION_ID = 's1'

export function runSessionLifecycleConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: archiveSession', () => {
    it('rejects an unknown session', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await expect(store.archiveSession(credId, `missing-${randomUUID()}`)).rejects.toMatchObject({
        code: 'session_not_found',
      })
    })

    it('sets a valid archivedAt and is idempotent on re-archive', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, SESSION_ID, null)

      const archived = await store.archiveSession(credId, SESSION_ID)
      expectValidTimestamp(archived.archivedAt)

      const reArchived = await store.archiveSession(credId, SESSION_ID)
      expect(reArchived.archivedAt).toBe(archived.archivedAt)
    })
  })

  describe('BlackboardStore conformance: patchSession', () => {
    it('rejects an unknown session', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await expect(
        store.patchSession(credId, { sessionId: `missing-${randomUUID()}`, data: { a: 1 } }),
      ).rejects.toMatchObject({ code: 'session_not_found' })
    })

    it('shallow-merges data on an active session, preserving and overwriting keys', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, SESSION_ID, null)

      await store.patchSession(credId, { sessionId: SESSION_ID, data: { a: 1, keep: true } })
      const patched = await store.patchSession(credId, { sessionId: SESSION_ID, data: { a: 2 } })
      expect(patched.data).toEqual({ a: 2, keep: true })
    })

    it('rejects patching an archived session', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, SESSION_ID, null)
      await store.archiveSession(credId, SESSION_ID)
      await expect(
        store.patchSession(credId, { sessionId: SESSION_ID, data: { late: true } }),
      ).rejects.toMatchObject({ code: 'session_archived' })
    })
  })
}
