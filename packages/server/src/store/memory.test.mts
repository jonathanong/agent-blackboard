import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryTelemetryStore } from './memory.mjs'

describe('MemoryTelemetryStore', () => {
  let fixedNow: Date
  let store: MemoryTelemetryStore

  beforeEach(() => {
    fixedNow = new Date('2024-01-01T00:00:00.000Z')
    store = new MemoryTelemetryStore({ now: () => fixedNow, ttlDays: 30 })
  })

  describe('appendEntry', () => {
    it('creates an entry with derived id, createdAt, archived=false, and ttl', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 'sess1',
        agent: 'claude',
        data: { a: 1 },
      })
      expect(entry.id.startsWith('sess1#')).toBe(true)
      expect(entry.credId).toBe('cred1')
      expect(entry.sessionId).toBe('sess1')
      expect(entry.agent).toBe('claude')
      expect(entry.archived).toBe(false)
      expect(entry.data).toEqual({ a: 1 })
      expect(entry.createdAt).toBe(fixedNow.toISOString())
      expect(entry.ttl).toBe(Math.floor(fixedNow.getTime() / 1000) + 30 * 86400)
    })

    it('uses a real clock when now is not provided', async () => {
      const defaultStore = new MemoryTelemetryStore()
      const entry = await defaultStore.appendEntry({
        credId: 'c',
        sessionId: 's',
        agent: 'a',
        data: {},
      })
      expect(new Date(entry.createdAt).getTime()).toBeGreaterThan(0)
    })

    it('uses the default ttl of 90 days when not provided', async () => {
      const defaultStore = new MemoryTelemetryStore({ now: () => fixedNow })
      const entry = await defaultStore.appendEntry({
        credId: 'c',
        sessionId: 's',
        agent: 'a',
        data: {},
      })
      expect(entry.ttl).toBe(Math.floor(fixedNow.getTime() / 1000) + 90 * 86400)
    })
  })

  describe('getEntries', () => {
    async function collect(iter: AsyncIterable<{ id: string }>): Promise<string[]> {
      const ids: string[] = []
      for await (const entry of iter) ids.push(entry.id)
      return ids
    }

    it('only returns entries for the given credId', async () => {
      await store.appendEntry({ credId: 'cred1', sessionId: 's', agent: 'a', data: {} })
      await store.appendEntry({ credId: 'cred2', sessionId: 's', agent: 'a', data: {} })
      const ids = await collect(store.getEntries('cred1', {}))
      expect(ids.length).toBe(1)
    })

    it('filters by sessionId', async () => {
      await store.appendEntry({ credId: 'cred1', sessionId: 's1', agent: 'a', data: {} })
      await store.appendEntry({ credId: 'cred1', sessionId: 's2', agent: 'a', data: {} })
      const ids = await collect(store.getEntries('cred1', { sessionId: 's1' }))
      expect(ids.every((id) => id.startsWith('s1#'))).toBe(true)
      expect(ids.length).toBe(1)
    })

    it('filters by agent', async () => {
      await store.appendEntry({ credId: 'cred1', sessionId: 's', agent: 'claude', data: {} })
      await store.appendEntry({ credId: 'cred1', sessionId: 's', agent: 'codex', data: {} })
      const ids = await collect(store.getEntries('cred1', { agent: 'codex' }))
      expect(ids.length).toBe(1)
    })

    it('filters by archived', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: {},
      })
      await store.appendEntry({ credId: 'cred1', sessionId: 's', agent: 'a', data: {} })
      await store.patchEntries('cred1', [{ id: entry.id, archived: true }])
      const archived = await collect(store.getEntries('cred1', { archived: true }))
      const active = await collect(store.getEntries('cred1', { archived: false }))
      expect(archived).toEqual([entry.id])
      expect(active.length).toBe(1)
    })

    it('returns nothing for an unknown credId', async () => {
      const ids = await collect(store.getEntries('nobody', {}))
      expect(ids).toEqual([])
    })
  })

  describe('patchEntries', () => {
    it('sets archived', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: {},
      })
      const [updated] = await store.patchEntries('cred1', [{ id: entry.id, archived: true }])
      expect(updated?.archived).toBe(true)
      expect(updated?.data).toEqual({})
    })

    it('shallow-merges data into the existing blob', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: { a: 1 },
      })
      const [updated] = await store.patchEntries('cred1', [{ id: entry.id, data: { b: 2 } }])
      expect(updated?.data).toEqual({ a: 1, b: 2 })
      expect(updated?.archived).toBe(false)
    })

    it('overwrites existing top-level keys on merge', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: { a: 1 },
      })
      const [updated] = await store.patchEntries('cred1', [{ id: entry.id, data: { a: 2 } }])
      expect(updated?.data).toEqual({ a: 2 })
    })

    it('applies both archived and data in one patch', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: {},
      })
      const [updated] = await store.patchEntries('cred1', [
        { id: entry.id, archived: true, data: { a: 1 } },
      ])
      expect(updated).toEqual({ ...entry, archived: true, data: { a: 1 } })
    })

    it('silently skips patches for unknown ids', async () => {
      const results = await store.patchEntries('cred1', [{ id: 'does-not-exist', archived: true }])
      expect(results).toEqual([])
    })

    it('does not patch entries belonging to a different credId', async () => {
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: {},
      })
      const results = await store.patchEntries('cred2', [{ id: entry.id, archived: true }])
      expect(results).toEqual([])
    })

    it('applies multiple patches in one call', async () => {
      const a = await store.appendEntry({ credId: 'cred1', sessionId: 's', agent: 'a', data: {} })
      const b = await store.appendEntry({ credId: 'cred1', sessionId: 's', agent: 'a', data: {} })
      const results = await store.patchEntries('cred1', [
        { id: a.id, archived: true },
        { id: b.id, archived: true },
      ])
      expect(results.length).toBe(2)
    })
  })

  describe('credentials', () => {
    it('creates a credential with a hashed token, never storing the raw token', async () => {
      const { record, token } = await store.createCredential('agent-1')
      expect(record.name).toBe('agent-1')
      expect(record.tokenHash).not.toBe(token)
      expect(record.createdAt).toBe(fixedNow.toISOString())
      const fetched = await store.getCredentialById(record.id)
      expect(fetched).toEqual(record)
    })

    it('lists all created credentials', async () => {
      await store.createCredential('a')
      await store.createCredential('b')
      const records = await store.listCredentials()
      expect(records.map((r) => r.name).sort()).toEqual(['a', 'b'])
    })

    it('returns undefined for an unknown credential id', async () => {
      expect(await store.getCredentialById('nope')).toBeUndefined()
    })

    it('deletes a credential by id', async () => {
      const { record } = await store.createCredential('a')
      expect(await store.deleteCredential({ id: record.id })).toBe(true)
      expect(await store.getCredentialById(record.id)).toBeUndefined()
    })

    it('returns false deleting an unknown id', async () => {
      expect(await store.deleteCredential({ id: 'nope' })).toBe(false)
    })

    it('deletes a credential by name', async () => {
      const { record } = await store.createCredential('by-name')
      expect(await store.deleteCredential({ name: 'by-name' })).toBe(true)
      expect(await store.getCredentialById(record.id)).toBeUndefined()
    })

    it('deletes ALL credentials matching name, leaving others untouched', async () => {
      const { record: a } = await store.createCredential('dup')
      const { record: b } = await store.createCredential('dup')
      const { record: other } = await store.createCredential('other')
      expect(await store.deleteCredential({ name: 'dup' })).toBe(true)
      expect(await store.getCredentialById(a.id)).toBeUndefined()
      expect(await store.getCredentialById(b.id)).toBeUndefined()
      expect(await store.getCredentialById(other.id)).toEqual(other)
    })

    it('returns false deleting an unknown name (skipping past a non-matching credential)', async () => {
      await store.createCredential('other')
      expect(await store.deleteCredential({ name: 'nope' })).toBe(false)
    })

    it('returns false when neither id nor name is given', async () => {
      expect(await store.deleteCredential({})).toBe(false)
    })
  })
})
