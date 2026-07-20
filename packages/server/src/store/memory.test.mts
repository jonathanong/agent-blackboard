import { describe, expect, it } from 'vitest'
import { runStoreConformance } from './conformance/index.mjs'
import { MemoryBlackboardStore } from './memory.mjs'

const NOW = new Date('2026-01-01T00:00:00.000Z')

runStoreConformance(() => new MemoryBlackboardStore({ now: () => NOW }))

describe('MemoryBlackboardStore', () => {
  it('uses the default clock when none is injected', async () => {
    const created = await new MemoryBlackboardStore().createCredential('clock')
    expect(Number.isNaN(Date.parse(created.record.createdAt))).toBe(false)
  })
})
