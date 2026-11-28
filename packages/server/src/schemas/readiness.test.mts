import { describe, expect, it } from 'vitest'
import { MemoryBlackboardStore } from '../store/memory.mjs'
import { assertSchemaEnforcementReady, checkSchemaEnforcementReadiness } from './readiness.mjs'

describe('schema enforcement readiness', () => {
  it('allows optional and shadow modes even when the registry is empty', async () => {
    const store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })
    expect(await checkSchemaEnforcementReadiness(store, {})).toEqual({ ok: true, mode: 'optional' })
    expect(
      await checkSchemaEnforcementReadiness(store, {
        AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'shadow',
      }),
    ).toEqual({ ok: true, mode: 'shadow' })
    await expect(assertSchemaEnforcementReady(store, {})).resolves.toBeUndefined()
  })

  it('rejects required mode until an active enforced schema exists', async () => {
    const store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })
    const requiredEnv = { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'required' }

    const empty = await checkSchemaEnforcementReadiness(store, requiredEnv)
    expect(empty.ok).toBe(false)
    expect(empty.mode).toBe('required')
    expect(empty.error).toMatch(/register and promote a schema.*shadow/)
    await expect(assertSchemaEnforcementReady(store, requiredEnv)).rejects.toThrow(
      /register and promote a schema.*shadow/,
    )

    // Shadow-only schema does not satisfy required readiness
    await store.putSchemaVersion({
      id: 'finding',
      schema: { type: 'object' },
      actor: 'ops',
      expectedVersion: 0,
      mode: 'shadow',
    })
    expect((await checkSchemaEnforcementReadiness(store, requiredEnv)).ok).toBe(false)

    // Promoting the schema makes required mode ready
    await store.promoteSchemaVersion('finding', 1, 'ops')
    expect(await checkSchemaEnforcementReadiness(store, requiredEnv)).toEqual({
      ok: true,
      mode: 'required',
    })
    await expect(assertSchemaEnforcementReady(store, requiredEnv)).resolves.toBeUndefined()

    // Deprecating the only enforced schema makes required mode unready again
    await store.deprecateSchema('finding', 'ops')
    expect((await checkSchemaEnforcementReadiness(store, requiredEnv)).ok).toBe(false)
  })
})
