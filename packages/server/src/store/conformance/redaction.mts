import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'
import { collect, createTestSession } from './helpers.mjs'

const CLIENT_TOKEN = ['abb', 'sk', 'a'.repeat(22), 'b'.repeat(24)].join('_')
const ADMIN_TOKEN = ['abb', 'admin', 'ops', 'c'.repeat(24)].join('_')
const PROVIDER_TOKEN = ['ghp', '1234567890abcdef1234567890'].join('_')

export function runRedactionConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: credential redaction', () => {
    it('redacts client and provider tokens from entry data and session patches before storing', async () => {
      const store = makeStore()
      const credId = randomUUID()
      const sessionId = `redact-${randomUUID()}`
      await createTestSession(store, credId, sessionId, null)

      const patched = await store.patchSession(credId, {
        sessionId,
        data: { authHeader: `Bearer ${ADMIN_TOKEN}` },
      })
      expect(patched.data).toEqual({
        authHeader: 'Bearer [REDACTED:agent_blackboard_admin_token]',
      })
      const fetchedSession = await store.getSession(credId, sessionId)
      expect(JSON.stringify(fetchedSession)).not.toContain(ADMIN_TOKEN)

      const appended = await store.appendEntry({
        credId,
        sessionId,
        data: {
          note: `failed with ${CLIENT_TOKEN}`,
          provider: { gh: PROVIDER_TOKEN },
        },
      })
      expect(appended.data).toEqual({
        note: 'failed with [REDACTED:agent_blackboard_client_token]',
        provider: { gh: '[REDACTED:github_token]' },
      })

      const storedEntries = await collect(store.getEntries(credId, sessionId))
      expect(storedEntries).toHaveLength(1)
      const serialized = JSON.stringify(storedEntries)
      expect(serialized).not.toContain(CLIENT_TOKEN)
      expect(serialized).not.toContain(PROVIDER_TOKEN)
      expect(storedEntries[0]?.data).toEqual(appended.data)
    })
  })
}
