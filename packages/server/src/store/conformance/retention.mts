import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { computeEntryExpiry, type TtlOverrides } from '../retention.mjs'
import type { BlackboardStore } from '../store.mjs'
import { collect, createTestSession } from './helpers.mjs'

export interface ConformanceRetentionOptions {
  ttlDays?: number
  ttlOverrides?: TtlOverrides
}

export function runRetentionConformance(
  makeStore: (options?: ConformanceRetentionOptions) => BlackboardStore,
): void {
  describe('BlackboardStore conformance: per-repository retention', () => {
    it('computes entry expiry from per-repository overrides with global default fallback', async () => {
      const store = makeStore({
        ttlDays: 90,
        ttlOverrides: { 'org/customer-app': 7, 'org/tooling': 180 },
      })
      const credId = randomUUID()
      const shortSession = `short-${randomUUID()}`
      const longSession = `long-${randomUUID()}`
      const multiSession = `multi-${randomUUID()}`
      const defaultSession = `default-${randomUUID()}`

      await createTestSession(store, credId, shortSession, null)
      await store.patchSession(credId, {
        sessionId: shortSession,
        data: { repository: 'Org/Customer-App' },
      })
      await createTestSession(store, credId, longSession, null)
      await store.patchSession(credId, {
        sessionId: longSession,
        data: { repositories: ['org/tooling'] },
      })
      await createTestSession(store, credId, multiSession, null)
      await store.patchSession(credId, {
        sessionId: multiSession,
        data: { repositories: ['org/tooling', 'org/customer-app'] },
      })
      await createTestSession(store, credId, defaultSession, null)
      await store.patchSession(credId, {
        sessionId: defaultSession,
        data: { repository: 'org/other' },
      })

      const shortEntry = await store.appendEntry({
        credId,
        sessionId: shortSession,
        data: { note: 'short' },
      })
      const longEntry = await store.appendEntry({
        credId,
        sessionId: longSession,
        data: { note: 'long' },
      })
      const multiEntry = await store.appendEntry({
        credId,
        sessionId: multiSession,
        data: { note: 'multi' },
      })
      const defaultEntry = await store.appendEntry({
        credId,
        sessionId: defaultSession,
        data: { note: 'default' },
      })

      expect(shortEntry.expiresAt).toBe(
        computeEntryExpiry(Date.parse(shortEntry.createdAt), 7).expiresAt,
      )
      expect(longEntry.expiresAt).toBe(
        computeEntryExpiry(Date.parse(longEntry.createdAt), 180).expiresAt,
      )
      expect(multiEntry.expiresAt).toBe(
        computeEntryExpiry(Date.parse(multiEntry.createdAt), 7).expiresAt,
      )
      expect(defaultEntry.expiresAt).toBe(
        computeEntryExpiry(Date.parse(defaultEntry.createdAt), 90).expiresAt,
      )

      // Patching the session later applies only to new entries, not previously stored ones
      await store.patchSession(credId, {
        sessionId: defaultSession,
        data: { repository: 'org/customer-app' },
      })
      const afterPatchEntry = await store.appendEntry({
        credId,
        sessionId: defaultSession,
        data: { note: 'after-patch' },
      })
      expect(afterPatchEntry.expiresAt).toBe(
        computeEntryExpiry(Date.parse(afterPatchEntry.createdAt), 7).expiresAt,
      )

      const stored = await collect(store.getEntries(credId, defaultSession))
      expect(stored).toEqual([defaultEntry, afterPatchEntry])
    })
  })
}
