import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runStoreConformance } from './conformance/index.mjs'
import { MemoryBlackboardStore } from './memory.mjs'
import { encodeSessionCursor } from './session-cursor.mjs'

const NOW = new Date('2026-01-01T00:00:00.000Z')

runStoreConformance(() => new MemoryBlackboardStore({ now: () => NOW }))

describe('MemoryBlackboardStore', () => {
  it('uses the default clock when none is injected', async () => {
    const created = await new MemoryBlackboardStore().createCredential('clock')
    expect(Number.isNaN(Date.parse(created.record.createdAt))).toBe(false)
  })

  it('returns an empty page with a null nextCursor for a cursor at or past the last session', async () => {
    const store = new MemoryBlackboardStore({ now: () => NOW })
    const credId = randomUUID()
    const last = await store.createSession({
      credId,
      id: 'last',
      parentSessionId: null,
      agent: 'a',
      version: '1.0.0',
    })

    // This cursor encodes the true last session's own key directly, rather
    // than a `nextCursor` this store ever emitted (emitting one for the
    // final page would be a bug: there is nothing after it). It reproduces
    // the one way a caller can drive `resumeIndex` to find no session
    // strictly after the key, which `listSessions` must treat as "start
    // beyond the end" rather than crash or wrap around.
    const cursor = encodeSessionCursor({ createdAt: last.createdAt, sessionId: last.id })
    const result = await store.listSessions(credId, { cursor })
    expect(result).toEqual({ sessions: [], nextCursor: null })
  })
})
