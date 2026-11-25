import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SessionStoreError } from '../errors.mjs'
import type { BlackboardStore } from '../store.mjs'

export function runSchemasConformance(makeStore: () => BlackboardStore): void {
  describe('BlackboardStore conformance: schemas', () => {
    it('publishes immutable schema versions, bumps revision, and preserves history', async () => {
      const store = makeStore()
      const id = `schema-${randomUUID()}`
      const rev0 = await store.getSchemaRegistryRevision()

      const v1Schema = { type: 'object', properties: { note: { type: 'string' } } }
      const v1 = await store.putSchemaVersion({
        id,
        schema: v1Schema,
        actor: 'alice',
        expectedVersion: 0,
      })
      expect(v1.revision).toBeGreaterThan(rev0)
      expect(v1.versionRecord.version).toBe(1)
      expect(v1.versionRecord.ref).toBe(`${id}@1`)
      expect(v1.versionRecord.createdBy).toBe('alice')
      expect(v1.summary.latestVersion).toBe(1)
      expect(v1.summary.deprecatedAt).toBeNull()

      // Mutating caller object does not mutate stored immutable version.
      v1Schema.properties.note.type = 'number'

      const v2 = await store.putSchemaVersion({
        id,
        schema: {
          type: 'object',
          properties: { note: { type: 'string' }, tag: { type: 'string' } },
        },
        actor: 'bob',
        expectedVersion: 1,
      })
      expect(v2.revision).toBeGreaterThan(v1.revision)
      expect(v2.versionRecord.version).toBe(2)
      expect(v2.summary.createdBy).toBe('alice')
      expect(v2.summary.updatedBy).toBe('bob')

      const fetchedV1 = await store.getSchema(id, 1)
      expect(fetchedV1?.versionRecord.schema).toEqual({
        type: 'object',
        properties: { note: { type: 'string' } },
      })
      const fetchedLatest = await store.getSchema(id)
      expect(fetchedLatest?.versionRecord.version).toBe(2)
      expect(await store.getSchema(id, 99)).toBeUndefined()
      expect(await store.getSchema(`missing-${randomUUID()}`)).toBeUndefined()

      const history = await store.listSchemaVersions(id)
      expect(history?.versions.map((v) => v.version)).toEqual([1, 2])
      expect(await store.listSchemaVersions(`missing-${randomUUID()}`)).toBeUndefined()

      const list = await store.listSchemas()
      expect(list.schemas.some((s) => s.id === id && s.latestVersion === 2)).toBe(true)

      const secondId = `a-second-${randomUUID()}`
      await store.putSchemaVersion({
        id: secondId,
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 0,
      })
      const sortedList = await store.listSchemas()
      const idxFirst = sortedList.schemas.findIndex((s) => s.id === secondId)
      const idxSecond = sortedList.schemas.findIndex((s) => s.id === id)
      expect(idxFirst).toBeGreaterThanOrEqual(0)
      expect(idxSecond).toBeGreaterThan(idxFirst)

      const bundle = await store.getSchemaBundle()
      const bundled = bundle.schemas.find((s) => s.id === id)
      expect(bundled?.versions.map((v) => v.version)).toEqual([1, 2])
    })

    it('rejects stale expectedVersion with schema_conflict', async () => {
      const store = makeStore()
      const id = `conflict-${randomUUID()}`
      await store.putSchemaVersion({
        id,
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 0,
      })
      await expect(
        store.putSchemaVersion({
          id,
          schema: { type: 'object' },
          actor: 'bob',
          expectedVersion: 0,
        }),
      ).rejects.toMatchObject({ code: 'schema_conflict' } satisfies Partial<SessionStoreError>)
    })

    it('deprecates schemas idempotently while keeping version history readable', async () => {
      const store = makeStore()
      const id = `dep-${randomUUID()}`
      await expect(store.deprecateSchema(id, 'alice')).rejects.toMatchObject({
        code: 'schema_not_found',
      })

      const put = await store.putSchemaVersion({
        id,
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 0,
      })
      const dep1 = await store.deprecateSchema(id, 'bob')
      expect(dep1.alreadyDeprecated).toBe(false)
      expect(dep1.revision).toBeGreaterThan(put.revision)
      expect(dep1.summary.deprecatedAt).not.toBeNull()
      expect(dep1.summary.deprecatedBy).toBe('bob')

      const dep2 = await store.deprecateSchema(id, 'carol')
      expect(dep2.alreadyDeprecated).toBe(true)
      expect(dep2.revision).toBe(dep1.revision)
      expect(dep2.summary.deprecatedBy).toBe('bob')

      // Cannot publish new versions after deprecation, but history remains readable.
      await expect(
        store.putSchemaVersion({
          id,
          schema: { type: 'object' },
          actor: 'alice',
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ code: 'schema_deprecated' })

      const fetched = await store.getSchema(id, 1)
      expect(fetched?.summary.deprecatedAt).toBe(dep1.summary.deprecatedAt)
      expect(fetched?.versionRecord.version).toBe(1)
    })
  })
}
