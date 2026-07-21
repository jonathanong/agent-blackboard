import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'

export function runCredentialsConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: credentials', () => {
    it('creates a credential with a token matching the client-token format', async () => {
      const store = makeStore()
      const created = await store.createCredential(`conformance-${randomUUID()}`)
      expect(created.token).toMatch(/^abb_sk_/)
      expect(await store.getCredentialById(created.record.id)).toEqual(created.record)
    })

    it('lists credentials by presence only, never an exact/absolute length', async () => {
      // CRED is one global partition shared by every caller (a locked
      // product decision), so a persistent, non-reset DynamoDB Local table
      // may already hold credentials left over from prior runs.
      // listCredentials() must only be checked for presence of the
      // credential this test created, never for an exact length.
      const store = makeStore()
      const created = await store.createCredential(`conformance-${randomUUID()}`)
      const all = await store.listCredentials()
      expect(all.some((record) => record.id === created.record.id)).toBe(true)
    })

    it('deletes a credential by id', async () => {
      const store = makeStore()
      const created = await store.createCredential(`conformance-${randomUUID()}`)
      expect(await store.deleteCredential({ id: created.record.id })).toBe(true)
      expect(await store.getCredentialById(created.record.id)).toBeUndefined()
      expect(await store.deleteCredential({ id: `definitely-missing-${randomUUID()}` })).toBe(false)
    })

    it('deletes all credentials matching a name', async () => {
      const store = makeStore()
      const name = `conformance-${randomUUID()}`
      const created = await store.createCredential(name)
      expect(await store.deleteCredential({ name })).toBe(true)
      expect(await store.getCredentialById(created.record.id)).toBeUndefined()
      expect(await store.deleteCredential({ name: `definitely-missing-${randomUUID()}` })).toBe(
        false,
      )
    })

    it('returns false when neither id nor name is given', async () => {
      const store = makeStore()
      expect(await store.deleteCredential({})).toBe(false)
    })
  })
}
