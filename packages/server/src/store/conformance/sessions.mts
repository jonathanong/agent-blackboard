import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'
import { AGENT, createTestSession, expectValidTimestamp } from './helpers.mjs'

/**
 * Session ids are deliberately ordered literals (`'s1' < 's2'`), not
 * `randomUUID()`. `listSessions` orders ascending by `(createdAt, id)` — the
 * `SessionsByCreatedAt` GSI's range key (Dynamo) and an equivalent in-memory
 * sort (memory store) both use this pair, tiebreaking on id (code-point
 * order) when timestamps collide, e.g. under a frozen test clock. These
 * fixture ids are chosen so id order also matches creation order, keeping
 * this test's plain equality assertion valid without pinning an ordering
 * guarantee beyond what both backends actually provide. See
 * `session-pagination.mts` for pagination/filter-specific conformance.
 */
const ROOT_ID = 's1'
const CHILD_ID = 's2'

export function runSessionsConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: create/get/list sessions', () => {
    it('creates, gets, and lists root and child sessions scoped by credId', async () => {
      const store = makeStore()
      const credId = randomUUID()

      const root = await createTestSession(store, credId, ROOT_ID, null)
      expect(root.id).toBe(ROOT_ID)
      expect(root.parentSessionId).toBeNull()
      expect(root.agent).toBe(AGENT.agent)
      expect(root.version).toBe(AGENT.version)
      expect(root.archivedAt).toBeNull()
      expect(root.data).toEqual({})
      expectValidTimestamp(root.createdAt)

      const child = await createTestSession(store, credId, CHILD_ID, ROOT_ID)
      expect(child.parentSessionId).toBe(ROOT_ID)

      expect(await store.getSession(credId, ROOT_ID)).toEqual(root)
      expect(await store.getSession(credId, CHILD_ID)).toEqual(child)
      expect(await store.getSession(credId, `missing-${randomUUID()}`)).toBeUndefined()

      expect((await store.listSessions(credId)).sessions).toEqual([root, child])
      expect((await store.listSessions(randomUUID())).sessions).toEqual([])
    })
  })

  describe('BlackboardStore conformance: createSession error codes', () => {
    it('rejects a duplicate id within the same credId', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, ROOT_ID, null)
      await expect(createTestSession(store, credId, ROOT_ID, null)).rejects.toMatchObject({
        code: 'session_exists',
      })
    })

    it('rejects a nonexistent parentSessionId', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await expect(
        createTestSession(store, credId, CHILD_ID, `missing-${randomUUID()}`),
      ).rejects.toMatchObject({ code: 'parent_not_found' })
    })

    it('rejects an archived parentSessionId', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await createTestSession(store, credId, ROOT_ID, null)
      await store.archiveSession(credId, ROOT_ID)
      await expect(createTestSession(store, credId, CHILD_ID, ROOT_ID)).rejects.toMatchObject({
        code: 'parent_archived',
      })
    })
  })
}
