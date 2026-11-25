import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import type { BlackboardStore } from '../store.mjs'

export function registerShadowSchemaConformanceTests(makeStore: () => BlackboardStore): void {
  it('registers shadow versions, records shadow failures without payloads, reports counts, and promotes idempotently', async () => {
    const store = makeStore()
    const id = `shadow-${randomUUID()}`

    await expect(store.promoteSchemaVersion(id, 1, 'alice')).rejects.toMatchObject({
      code: 'schema_not_found',
    })
    expect(await store.getSchemaShadowReport(id)).toBeUndefined()

    const v1 = await store.putSchemaVersion({
      id,
      schema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      actor: 'alice',
      expectedVersion: 0,
      mode: 'shadow',
    })
    expect(v1.versionRecord.mode).toBe('shadow')
    expect(v1.versionRecord.promotedAt).toBeNull()
    expect(v1.versionRecord.promotedBy).toBeNull()

    const v2 = await store.putSchemaVersion({
      id,
      schema: {
        type: 'object',
        properties: { title: { type: 'string' }, tag: { type: 'string' } },
        required: ['title'],
      },
      actor: 'alice',
      expectedVersion: 1,
    })
    expect(v2.versionRecord.mode).toBe('enforced')

    expect(await store.getSchemaShadowReport(id, { version: 99 })).toBeUndefined()
    const emptyV1 = await store.getSchemaShadowReport(id, { version: 1 })
    expect(emptyV1).toMatchObject({ id, version: 1, totalFailures: 0, recentFailures: [] })

    await store.recordSchemaShadowFailure({
      schemaId: id,
      schemaVersion: 1,
      sessionId: 'sess-1',
      code: 'schema_validation_failed',
      message: 'missing title',
      details: [
        {
          instancePath: '',
          schemaPath: '#/required',
          keyword: 'required',
          message: "must have required property 'title'",
        },
      ],
    })
    await store.recordSchemaShadowFailure({
      schemaId: id,
      schemaVersion: 1,
      sessionId: 'sess-2',
      code: 'schema_validation_failed',
      message: 'title wrong type',
      details: [],
    })

    const v1Report = await store.getSchemaShadowReport(id, { version: 1, limit: 1 })
    expect(v1Report).toMatchObject({ id, version: 1, totalFailures: 2 })
    expect(v1Report?.versions).toEqual([
      expect.objectContaining({ version: 1, mode: 'shadow', failureCount: 2 }),
    ])
    expect(v1Report?.recentFailures).toHaveLength(1)
    expect(v1Report?.recentFailures[0]).not.toHaveProperty('data')

    const allReport = await store.getSchemaShadowReport(id)
    expect(allReport).toMatchObject({ id, version: null, totalFailures: 2 })
    expect(allReport?.versions.map((v) => [v.version, v.mode, v.failureCount])).toEqual([
      [1, 'shadow', 2],
      [2, 'enforced', 0],
    ])
    expect(allReport?.recentFailures).toHaveLength(2)

    const promoted = await store.promoteSchemaVersion(id, 1, 'bob')
    expect(promoted.alreadyEnforced).toBe(false)
    expect(promoted.revision).toBeGreaterThan(v2.revision)
    expect(promoted.versionRecord.mode).toBe('enforced')
    expect(promoted.versionRecord.promotedBy).toBe('bob')
    expect(promoted.versionRecord.promotedAt).not.toBeNull()

    const promotedAgain = await store.promoteSchemaVersion(id, 1, 'carol')
    expect(promotedAgain.alreadyEnforced).toBe(true)
    expect(promotedAgain.revision).toBe(promoted.revision)
    expect(promotedAgain.versionRecord.promotedBy).toBe('bob')

    await store.deprecateSchema(id, 'bob')
    await expect(store.promoteSchemaVersion(id, 1, 'bob')).rejects.toMatchObject({
      code: 'schema_deprecated',
    })
  })
}
