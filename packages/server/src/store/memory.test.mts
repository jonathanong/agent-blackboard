import { describe, expect, it } from 'vitest'
import { SessionStoreError } from './errors.mjs'
import { MemoryBlackboardStore } from './memory.mjs'

const NOW = new Date('2026-01-01T00:00:00.000Z')

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

function store(): MemoryBlackboardStore {
  return new MemoryBlackboardStore({ now: () => NOW })
}

describe('MemoryBlackboardStore sessions', () => {
  it('creates, gets, and lists root and child sessions', async () => {
    const subject = store()
    const root = await subject.createSession({ credId: 'c', id: 'root', parentSessionId: null })
    const child = await subject.createSession({ credId: 'c', id: 'child', parentSessionId: 'root' })
    expect(root).toEqual({
      id: 'root',
      parentSessionId: null,
      createdAt: NOW.toISOString(),
      archivedAt: null,
    })
    expect(child.parentSessionId).toBe('root')
    expect(await subject.getSession('c', 'child')).toEqual(child)
    expect(await subject.getSession('other', 'child')).toBeUndefined()
    expect(await collect(subject.listSessions('c'))).toEqual([root, child])
    expect(await collect(subject.listSessions('other'))).toEqual([])
  })

  it('rejects duplicates, missing parents, and archived parents', async () => {
    const subject = store()
    await subject.createSession({ credId: 'c', id: 'root', parentSessionId: null })
    await expect(
      subject.createSession({ credId: 'c', id: 'root', parentSessionId: null }),
    ).rejects.toMatchObject({ code: 'session_exists' })
    await expect(
      subject.createSession({ credId: 'c', id: 'child', parentSessionId: 'missing' }),
    ).rejects.toMatchObject({ code: 'parent_not_found' })
    await subject.archiveSession('c', 'root')
    await expect(
      subject.createSession({ credId: 'c', id: 'child', parentSessionId: 'root' }),
    ).rejects.toMatchObject({ code: 'parent_archived' })
  })

  it('archives once and rejects an unknown session', async () => {
    const subject = store()
    await expect(subject.archiveSession('c', 'missing')).rejects.toBeInstanceOf(SessionStoreError)
    await subject.createSession({ credId: 'c', id: 'root', parentSessionId: null })
    const archived = await subject.archiveSession('c', 'root')
    expect(archived.archivedAt).toBe(NOW.toISOString())
    expect(await subject.archiveSession('c', 'root')).toBe(archived)
  })
})

describe('MemoryBlackboardStore entries', () => {
  it('requires an active session and creates collision-safe timestamps', async () => {
    const subject = store()
    await expect(
      subject.appendEntry({ credId: 'c', sessionId: 'missing', data: {} }),
    ).rejects.toMatchObject({ code: 'session_not_found' })
    await subject.createSession({ credId: 'c', id: 's', parentSessionId: null })
    const first = await subject.appendEntry({ credId: 'c', sessionId: 's', data: { i: 1 } })
    const second = await subject.appendEntry({ credId: 'c', sessionId: 's', data: { i: 2 } })
    await subject.createSession({ credId: 'other', id: 's', parentSessionId: null })
    await subject.appendEntry({ credId: 'other', sessionId: 's', data: { i: 3 } })
    expect(first.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(second.createdAt).toBe('2026-01-01T00:00:00.001Z')
    expect(await collect(subject.getEntries('c', 's'))).toEqual([first, second])
  })

  it('patches by sessionId+createdAt and rejects missing or archived entries', async () => {
    const subject = store()
    await subject.createSession({ credId: 'c', id: 's', parentSessionId: null })
    const entry = await subject.appendEntry({ credId: 'c', sessionId: 's', data: { a: 1 } })
    expect(
      await subject.patchEntry('c', {
        sessionId: 's',
        createdAt: entry.createdAt,
        data: { b: 2 },
      }),
    ).toMatchObject({ data: { a: 1, b: 2 } })
    await expect(
      subject.patchEntry('c', { sessionId: 's', createdAt: 'missing', data: {} }),
    ).rejects.toMatchObject({ code: 'entry_not_found' })
    await subject.archiveSession('c', 's')
    await expect(collect(subject.getEntries('c', 's'))).rejects.toMatchObject({
      code: 'session_archived',
    })
    await expect(
      subject.patchEntry('c', { sessionId: 's', createdAt: entry.createdAt, data: {} }),
    ).rejects.toMatchObject({ code: 'session_archived' })
    await expect(
      subject.appendEntry({ credId: 'c', sessionId: 's', data: {} }),
    ).rejects.toMatchObject({ code: 'session_archived' })
  })
})

describe('MemoryBlackboardStore credentials', () => {
  it('creates, lists, looks up, and deletes credentials by id or name', async () => {
    const subject = store()
    const first = await subject.createCredential('same')
    await subject.createCredential('same')
    expect(first.token).toMatch(/^abb_sk_/)
    expect(await subject.getCredentialById(first.record.id)).toEqual(first.record)
    expect(await subject.listCredentials()).toHaveLength(2)
    expect(await subject.deleteCredential({ id: first.record.id })).toBe(true)
    expect(await subject.deleteCredential({ id: 'missing' })).toBe(false)
    expect(await subject.deleteCredential({ name: 'same' })).toBe(true)
    expect(await subject.deleteCredential({ name: 'missing' })).toBe(false)
    expect(await subject.deleteCredential({})).toBe(false)
  })

  it('uses the default clock when none is injected', async () => {
    const created = await new MemoryBlackboardStore().createCredential('clock')
    expect(Number.isNaN(Date.parse(created.record.createdAt))).toBe(false)
  })
})
