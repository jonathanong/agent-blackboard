import { describe, expect, it, vi } from 'vitest'
import { MemoryBlackboardStore } from '../store/memory.mjs'
import { validateEntryWrite } from './enforce.mjs'

describe('validateEntryWrite', () => {
  it('enforces optional vs required mode and validates schemaId/schemaVersion arguments', async () => {
    const store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })

    expect(await validateEntryWrite(store, {}, { note: 'x' }, {})).toEqual({ ok: true })
    expect(
      await validateEntryWrite(
        store,
        {},
        { note: 'x' },
        { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'required' },
      ),
    ).toMatchObject({ ok: false, status: 400, body: { code: 'schema_required' } })

    expect(await validateEntryWrite(store, { schemaVersion: 1 }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'invalid_schema_ref' },
    })
    expect(await validateEntryWrite(store, { schemaId: 'bad/id' }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'invalid_schema_ref' },
    })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding', schemaVersion: 0 }, {}, {}),
    ).toMatchObject({ ok: false, body: { code: 'invalid_schema_ref' } })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding', schemaVersion: '1' }, {}, {}),
    ).toMatchObject({ ok: false, body: { code: 'invalid_schema_ref' } })
  })

  it('validates entries against latest and pinned schemas, caches per revision, and rejects invalid or deprecated schemas', async () => {
    const store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })
    await store.putSchemaVersion({
      id: 'finding',
      schema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      actor: 'ops',
      expectedVersion: 0,
    })

    // Missing schema and missing version
    expect(await validateEntryWrite(store, { schemaId: 'missing' }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'schema_not_found' },
    })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding', schemaVersion: 9 }, {}, {}),
    ).toMatchObject({ ok: false, body: { code: 'schema_not_found' } })

    // Valid latest write + cache hit on second call
    const bundleSpy = vi.spyOn(store, 'getSchemaBundle')
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'first' }, {}),
    ).toEqual({ ok: true, schemaId: 'finding', schemaVersion: 1 })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'second' }, {}),
    ).toEqual({ ok: true, schemaId: 'finding', schemaVersion: 1 })
    expect(bundleSpy).toHaveBeenCalledTimes(1)

    // Invalid payload returns structured validation details
    const failed = await validateEntryWrite(store, { schemaId: 'finding' }, { title: 42 }, {})
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.body).toMatchObject({
        code: 'schema_validation_failed',
        schema: 'finding@1',
      })
      expect((failed.body.details as unknown[]).length).toBeGreaterThan(0)
    }

    // Publish v2 -> revision advances -> cache invalidates and validates against v2
    await store.putSchemaVersion({
      id: 'finding',
      schema: {
        type: 'object',
        properties: { title: { type: 'string' }, severity: { type: 'string' } },
        required: ['title', 'severity'],
      },
      actor: 'ops',
      expectedVersion: 1,
    })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'only-title' }, {}),
    ).toMatchObject({ ok: false, body: { code: 'schema_validation_failed', schema: 'finding@2' } })
    expect(
      await validateEntryWrite(
        store,
        { schemaId: 'finding', schemaVersion: 1 },
        { title: 'v1-ok' },
        {},
      ),
    ).toEqual({ ok: true, schemaId: 'finding', schemaVersion: 1 })

    // Deprecate schema -> new writes rejected
    await store.deprecateSchema('finding', 'ops')
    expect(
      await validateEntryWrite(
        store,
        { schemaId: 'finding' },
        { title: 'x', severity: 'high' },
        {},
      ),
    ).toMatchObject({ ok: false, body: { code: 'schema_deprecated' } })
  })

  it('returns schema_invalid if a stored schema fails compilation', async () => {
    const store = new MemoryBlackboardStore({ now: () => new Date('2026-01-01T00:00:00.000Z') })
    await store.putSchemaVersion({
      id: 'corrupt',
      schema: { type: 'object', unknownKeyword: true },
      actor: 'ops',
      expectedVersion: 0,
    })
    expect(await validateEntryWrite(store, { schemaId: 'corrupt' }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'schema_invalid' },
    })
  })
})
