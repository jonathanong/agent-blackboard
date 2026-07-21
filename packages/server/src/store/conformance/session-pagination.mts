import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'
import { AGENT } from './helpers.mjs'

interface VariedSessionIds {
  root: string
  child: string
  other: string
  archived: string
}

/** Seeds sessions that differ on every filterable field so each filter kind has an unambiguous subset. */
async function createVariedSessions(
  store: BlackboardStore,
  credId: string,
): Promise<VariedSessionIds> {
  const root = await store.createSession({
    credId,
    id: `root-${randomUUID()}`,
    parentSessionId: null,
    ...AGENT,
  })
  const child = await store.createSession({
    credId,
    id: `child-${randomUUID()}`,
    parentSessionId: root.id,
    agent: AGENT.agent,
    version: '2.0.0',
  })
  const other = await store.createSession({
    credId,
    id: `other-${randomUUID()}`,
    parentSessionId: null,
    agent: 'other-agent',
    version: AGENT.version,
  })
  const archived = await store.createSession({
    credId,
    id: `archived-${randomUUID()}`,
    parentSessionId: null,
    ...AGENT,
  })
  await store.archiveSession(credId, archived.id)
  await store.patchSession(credId, { sessionId: child.id, data: { branch: 'main' } })
  return { root: root.id, child: child.id, other: other.id, archived: archived.id }
}

export function runSessionPaginationConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: listSessions filter pushdown', () => {
    it('filters by agent, version, parentSessionId, data, and archived', async () => {
      const store = makeStore()
      const credId = randomUUID()
      const ids = await createVariedSessions(store, credId)

      const byAgent = await store.listSessions(credId, { agent: 'other-agent' })
      expect(byAgent.sessions.map((s) => s.id)).toEqual([ids.other])

      const byVersion = await store.listSessions(credId, { version: '2.0.0' })
      expect(byVersion.sessions.map((s) => s.id)).toEqual([ids.child])

      const byParent = await store.listSessions(credId, { parentSessionId: ids.root })
      expect(byParent.sessions.map((s) => s.id)).toEqual([ids.child])

      const byNullParent = await store.listSessions(credId, { parentSessionId: null })
      expect(new Set(byNullParent.sessions.map((s) => s.id))).toEqual(
        new Set([ids.root, ids.other, ids.archived]),
      )

      const byData = await store.listSessions(credId, { data: { branch: 'main' } })
      expect(byData.sessions.map((s) => s.id)).toEqual([ids.child])

      const byArchived = await store.listSessions(credId, { archived: true })
      expect(byArchived.sessions.map((s) => s.id)).toEqual([ids.archived])

      const byNotArchived = await store.listSessions(credId, { archived: false })
      expect(new Set(byNotArchived.sessions.map((s) => s.id))).toEqual(
        new Set([ids.root, ids.child, ids.other]),
      )
    })
  })

  describe('BlackboardStore conformance: listSessions pagination', () => {
    it('pages through results via nextCursor without loss or duplication', async () => {
      const store = makeStore()
      const credId = randomUUID()
      const created: string[] = []
      for (let i = 0; i < 5; i += 1) {
        const session = await store.createSession({
          credId,
          id: `page-${i}-${randomUUID()}`,
          parentSessionId: null,
          ...AGENT,
        })
        created.push(session.id)
      }

      const seen = new Set<string>()
      let cursor: string | undefined
      let iterations = 0
      do {
        const page = await store.listSessions(
          credId,
          cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
        )
        for (const session of page.sessions) seen.add(session.id)
        cursor = page.nextCursor ?? undefined
        iterations += 1
        expect(iterations).toBeLessThanOrEqual(created.length + 1)
      } while (cursor !== undefined)

      expect(seen).toEqual(new Set(created))
    })

    it('rejects a malformed cursor with an invalid_cursor error', async () => {
      const store = makeStore()
      const credId = randomUUID()
      await expect(
        store.listSessions(credId, { cursor: 'not-a-real-cursor' }),
      ).rejects.toMatchObject({ code: 'invalid_cursor' })
    })
  })
}
