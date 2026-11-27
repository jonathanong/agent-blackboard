import { describe, expect, it, vi } from 'vitest'
import { MemoryBlackboardStore } from '../store/memory.mjs'
import { getSnapshotCache } from './enforce-cache.mjs'
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
        { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'optional' },
      ),
    ).toEqual({ ok: true })
    expect(
      await validateEntryWrite(
        store,
        {},
        { note: 'x' },
        { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'required' },
      ),
    ).toMatchObject({ ok: false, status: 400, body: { code: 'schema_required' } })
    await expect(
      validateEntryWrite(store, {}, { note: 'x' }, { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'true' }),
    ).rejects.toThrow(/Invalid AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT/)

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

    // Missing schema and missing version reuse the cached revision bundle without growing lookup cache
    const bundleSpy = vi.spyOn(store, 'getSchemaBundle')
    expect(await validateEntryWrite(store, { schemaId: 'missing' }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'schema_not_found' },
    })
    expect(await validateEntryWrite(store, { schemaId: 'missing' }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'schema_not_found' },
    })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding', schemaVersion: 9 }, {}, {}),
    ).toMatchObject({ ok: false, body: { code: 'schema_not_found' } })
    expect((await getSnapshotCache(store, 1)).lookups.size).toBe(0)

    // Valid latest write + cache hit on second call
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'first' }, {}),
    ).toEqual({ ok: true, schemaId: 'finding', schemaVersion: 1, revision: 1 })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'second' }, {}),
    ).toEqual({ ok: true, schemaId: 'finding', schemaVersion: 1, revision: 1 })
    expect(bundleSpy).toHaveBeenCalledTimes(1)

    // Monotonic cache: a slower concurrent getSchemaBundle resolving an older revision never downgrades a newer cache
    const revSpy = vi.spyOn(store, 'getSchemaRegistryRevision')
    revSpy.mockResolvedValueOnce(5)
    bundleSpy.mockResolvedValueOnce({ revision: 1, schemas: [] })
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'still-cached' }, {}),
    ).toEqual({
      ok: true,
      schemaId: 'finding',
      schemaVersion: 1,
      revision: 1,
    })
    revSpy.mockRestore()

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
    ).toEqual({ ok: true, schemaId: 'finding', schemaVersion: 1, revision: 2 })

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

  it('supports per-version shadow mode and global AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT=shadow', async () => {
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
      mode: 'shadow',
    })
    await store.putSchemaVersion({
      id: 'strict',
      schema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      actor: 'ops',
      expectedVersion: 0,
    })

    // Per-version shadow: valid entry passes cleanly with no warning
    expect(await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'ok' }, {})).toEqual({
      ok: true,
      schemaId: 'finding',
      schemaVersion: 1,
      revision: 2,
    })

    // Per-version shadow: invalid entry is accepted with warning + pending shadowFailure, without tagging the failed version
    const perSchemaFail = await validateEntryWrite(
      store,
      { schemaId: 'finding' },
      { secretPayload: 'do-not-log' },
      {},
    )
    expect(perSchemaFail).toMatchObject({
      ok: true,
      warning: { code: 'schema_validation_failed', schema: 'finding@1' },
      shadowFailure: {
        schemaId: 'finding',
        schemaVersion: 1,
        code: 'schema_validation_failed',
      },
    })
    if (perSchemaFail.ok) {
      expect(perSchemaFail.schemaId).toBeUndefined()
      expect(perSchemaFail.schemaVersion).toBeUndefined()
    }

    // Promoting switches the version from shadow to enforced (revision bumps -> cache invalidates)
    await store.promoteSchemaVersion('finding', 1, 'ops')
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { wrong: true }, {}),
    ).toMatchObject({ ok: false, status: 400, body: { code: 'schema_validation_failed' } })

    // Global shadow mode validates every named schema and rejects nothing
    const shadowEnv = { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'shadow' }
    expect(await validateEntryWrite(store, {}, { free: true }, shadowEnv)).toEqual({ ok: true })
    expect(await validateEntryWrite(store, { schemaVersion: 1 }, {}, shadowEnv)).toMatchObject({
      ok: true,
      warning: { code: 'invalid_schema_ref' },
    })
    expect(await validateEntryWrite(store, { schemaId: 'bad/id' }, {}, shadowEnv)).toMatchObject({
      ok: true,
      warning: { code: 'invalid_schema_ref' },
    })
    expect(
      await validateEntryWrite(store, { schemaId: 'strict', schemaVersion: 0 }, {}, shadowEnv),
    ).toMatchObject({ ok: true, warning: { code: 'invalid_schema_ref' } })
    expect(await validateEntryWrite(store, { schemaId: 'missing' }, {}, shadowEnv)).toMatchObject({
      ok: true,
      warning: { code: 'schema_not_found' },
    })
    const globalShadowFail = await validateEntryWrite(
      store,
      { schemaId: 'strict' },
      { bad: true },
      shadowEnv,
    )
    expect(globalShadowFail).toMatchObject({
      ok: true,
      warning: { code: 'schema_validation_failed', schema: 'strict@1' },
      shadowFailure: { schemaId: 'strict', schemaVersion: 1, code: 'schema_validation_failed' },
    })
    if (globalShadowFail.ok) {
      expect(globalShadowFail.schemaId).toBeUndefined()
      expect(globalShadowFail.schemaVersion).toBeUndefined()
    }

    // Deprecated schema under global shadow: accepted with warning + shadowFailure (for existing version) or without (for unknown version)
    await store.deprecateSchema('strict', 'ops')
    expect(
      await validateEntryWrite(store, { schemaId: 'strict' }, { title: 'late' }, shadowEnv),
    ).toMatchObject({
      ok: true,
      warning: { code: 'schema_deprecated' },
      shadowFailure: { schemaId: 'strict', schemaVersion: 1, code: 'schema_deprecated' },
    })
    const depUnknownVer = await validateEntryWrite(
      store,
      { schemaId: 'strict', schemaVersion: 99 },
      { title: 'late' },
      shadowEnv,
    )
    expect(depUnknownVer).toMatchObject({ ok: true, warning: { code: 'schema_deprecated' } })
    if (depUnknownVer.ok) expect(depUnknownVer.shadowFailure).toBeUndefined()
    expect((await getSnapshotCache(store, 4)).lookups.has('strict@99')).toBe(false)
  })

  it('preserves latest enforced baseline when a newer shadow version is published', async () => {
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
    await store.putSchemaVersion({
      id: 'finding',
      schema: {
        type: 'object',
        properties: { title: { type: 'string' }, tag: { type: 'string' } },
        required: ['title'],
      },
      actor: 'ops',
      expectedVersion: 1,
    })
    await store.putSchemaVersion({
      id: 'finding',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          tag: { type: 'string' },
          severity: { type: 'string' },
        },
        required: ['title', 'severity'],
      },
      actor: 'ops',
      expectedVersion: 2,
      mode: 'shadow',
    })

    // Unpinned write failing enforced v2 baseline is still rejected with 400
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { wrong: 1 }, {}),
    ).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'schema_validation_failed', schema: 'finding@2' },
    })

    // Under global shadow mode, failing the baseline warns without tagging schemaId/schemaVersion
    const globalBaselineFail = await validateEntryWrite(
      store,
      { schemaId: 'finding' },
      { wrong: 1 },
      { AGENT_BLACKBOARD_SCHEMA_ENFORCEMENT: 'shadow' },
    )
    expect(globalBaselineFail).toMatchObject({
      ok: true,
      warning: { code: 'schema_validation_failed', schema: 'finding@2' },
      shadowFailure: { schemaId: 'finding', schemaVersion: 2 },
    })
    if (globalBaselineFail.ok) {
      expect(globalBaselineFail.schemaId).toBeUndefined()
      expect(globalBaselineFail.schemaVersion).toBeUndefined()
    }

    // Passing enforced v2 baseline but failing shadow v3: accepted, tagged v2, warns & logs v3
    expect(
      await validateEntryWrite(store, { schemaId: 'finding' }, { title: 'only-v2' }, {}),
    ).toMatchObject({
      ok: true,
      schemaId: 'finding',
      schemaVersion: 2,
      warning: { code: 'schema_validation_failed', schema: 'finding@3' },
      shadowFailure: { schemaId: 'finding', schemaVersion: 3, code: 'schema_validation_failed' },
    })

    // Passing both v2 and shadow v3: accepted and tagged v3 with no warning
    expect(
      await validateEntryWrite(
        store,
        { schemaId: 'finding' },
        { title: 'full', severity: 'high' },
        {},
      ),
    ).toEqual({
      ok: true,
      schemaId: 'finding',
      schemaVersion: 3,
      revision: 3,
    })

    // Pinned write against shadow v3 bypasses baseline and omits tags when v3 fails
    const pinnedFail = await validateEntryWrite(
      store,
      { schemaId: 'finding', schemaVersion: 3 },
      { wrong: 1 },
      {},
    )
    expect(pinnedFail).toMatchObject({
      ok: true,
      warning: { code: 'schema_validation_failed', schema: 'finding@3' },
      shadowFailure: { schemaId: 'finding', schemaVersion: 3 },
    })
    if (pinnedFail.ok) {
      expect(pinnedFail.schemaId).toBeUndefined()
      expect(pinnedFail.schemaVersion).toBeUndefined()
    }

    // Corrupt enforced baseline reports schema_invalid
    await store.putSchemaVersion({
      id: 'broken-baseline',
      schema: { type: 'object', unknownKeyword: true },
      actor: 'ops',
      expectedVersion: 0,
    })
    await store.putSchemaVersion({
      id: 'broken-baseline',
      schema: { type: 'object' },
      actor: 'ops',
      expectedVersion: 1,
      mode: 'shadow',
    })
    expect(await validateEntryWrite(store, { schemaId: 'broken-baseline' }, {}, {})).toMatchObject({
      ok: false,
      body: { code: 'schema_invalid' },
    })
  })
})
