import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import {
  dynamoGetSchema,
  dynamoGetSchemaBundle,
  dynamoGetSchemaRegistryRevision,
  dynamoListSchemaVersions,
  dynamoListSchemas,
} from './dynamo-schemas-read.mjs'
import { dynamoDeprecateSchema, dynamoPutSchemaVersion } from './dynamo-schemas-write.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function mockDoc(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const NOW = () => new Date('2026-01-01T00:00:00.000Z')

const HEAD_A = {
  id: 'a',
  latestVersion: 1,
  deprecatedAt: null,
  deprecatedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'alice',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'alice',
}

const VER_A1 = {
  id: 'a',
  version: 1,
  schema: { type: 'object' },
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'alice',
}

function canceledError(): Error {
  const err = new Error('canceled')
  err.name = 'TransactionCanceledException'
  return err
}

describe('DynamoDB schemas read helpers', () => {
  it('defaults revision to 0 and paginates queries for list, versions, and bundle', async () => {
    let listPage = 0
    const doc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string; SK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 3 } }
        if (key.PK === 'SCHEMAS' && key.SK === 'SCHEMA#a') return { Item: HEAD_A }
        if (key.PK === 'SCHEMA_VERSIONS' && key.SK === 'SCHEMA#a#V#0000000001') {
          return { Item: VER_A1 }
        }
        return {}
      }
      if (command.constructor.name === 'QueryCommand') {
        const values = command.input.ExpressionAttributeValues as Record<string, string>
        if (values[':pk'] === 'SCHEMAS') {
          listPage += 1
          return listPage === 1
            ? {
                Items: [{ ...HEAD_A, id: 'b' }],
                LastEvaluatedKey: { PK: 'SCHEMAS', SK: 'SCHEMA#b' },
              }
            : { Items: [HEAD_A] }
        }
        return { Items: [{ ...VER_A1, version: 2 }, VER_A1] }
      }
      throw new Error(`unexpected ${command.constructor.name}`)
    })

    expect(await dynamoGetSchemaRegistryRevision(doc, 'T')).toBe(3)
    const emptyRevDoc = mockDoc(() => ({}))
    expect(await dynamoGetSchemaRegistryRevision(emptyRevDoc, 'T')).toBe(0)

    const list = await dynamoListSchemas(doc, 'T')
    expect(list.revision).toBe(3)
    expect(list.schemas.map((s) => s.id)).toEqual(['a', 'b'])

    expect((await dynamoGetSchema(doc, 'T', 'a'))?.versionRecord.version).toBe(1)
    expect(await dynamoGetSchema(doc, 'T', 'a', 99)).toBeUndefined()
    expect(await dynamoGetSchema(doc, 'T', 'missing')).toBeUndefined()

    const versions = await dynamoListSchemaVersions(doc, 'T', 'a')
    expect(versions?.versions.map((v) => v.version)).toEqual([1, 2])
    expect(await dynamoListSchemaVersions(doc, 'T', 'missing')).toBeUndefined()

    listPage = 0
    const bundle = await dynamoGetSchemaBundle(doc, 'T')
    expect(bundle.schemas.find((s) => s.id === 'a')?.versions.map((v) => v.version)).toEqual([1, 2])
    expect(bundle.schemas.find((s) => s.id === 'b')?.versions).toEqual([])
  })

  it('retries inconsistent snapshots and throws schema_conflict when revision keeps moving', async () => {
    let revCalls = 0
    const retryDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        expect(command.input.ConsistentRead).toBe(true)
        revCalls += 1
        // 1st read returns rev 1, 2nd returns rev 2 (retry!), 3rd & 4th both return rev 2
        return { Item: { revision: revCalls === 1 ? 1 : 2 } }
      }
      expect(command.input.ConsistentRead).toBe(true)
      return { Items: [HEAD_A] }
    })
    const list = await dynamoListSchemas(retryDoc, 'T')
    expect(list.revision).toBe(2)

    let moving = 0
    const movingDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        moving += 1
        return { Item: { revision: moving } }
      }
      return { Items: [] }
    })
    await expect(dynamoListSchemas(movingDoc, 'T')).rejects.toMatchObject({
      code: 'schema_conflict',
    })
  })

  it('handles empty query pages with undefined Items', async () => {
    const doc = mockDoc(() => ({}))
    expect((await dynamoListSchemas(doc, 'T')).schemas).toEqual([])
    expect((await dynamoGetSchemaBundle(doc, 'T')).schemas).toEqual([])
  })
})

describe('DynamoDB schemas write helpers', () => {
  it('writes v1 and v2, retries revision contention, and handles conflict/deprecated/errors', async () => {
    let txCalls = 0
    const doc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string; SK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return txCalls === 0 ? {} : { Item: { revision: 1 } }
        return {}
      }
      if (command.constructor.name === 'TransactWriteCommand') {
        txCalls += 1
        if (txCalls === 1) throw canceledError()
        return {}
      }
      throw new Error(`unexpected ${command.constructor.name}`)
    })

    const v1 = await dynamoPutSchemaVersion(doc, 'T', NOW, {
      id: 'a',
      schema: { type: 'object' },
      actor: 'alice',
      expectedVersion: 0,
    })
    expect(v1.revision).toBe(2)
    expect(v1.versionRecord.version).toBe(1)

    // Successful v2 update asserts transaction items check head v1 and advance revision + version
    let v2Tx: Record<string, unknown> | undefined
    const v2Doc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        return key.PK === 'SCHEMA_REGISTRY' ? { Item: { revision: 2 } } : { Item: HEAD_A }
      }
      v2Tx = command.input
      return {}
    })
    const v2 = await dynamoPutSchemaVersion(v2Doc, 'T', NOW, {
      id: 'a',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
      actor: 'bob',
      expectedVersion: 1,
      expectedRevision: 2,
    })
    expect(v2.revision).toBe(3)
    expect(v2.versionRecord.version).toBe(2)
    const txItems = v2Tx!.TransactItems as Array<Record<string, unknown>>
    expect(txItems).toHaveLength(3)
    expect(txItems[1]).toMatchObject({
      Update: {
        ConditionExpression: 'latestVersion = :expectedVersion AND deprecatedAt = :null',
        ExpressionAttributeValues: expect.objectContaining({
          ':expectedVersion': 1,
          ':nextVersion': 2,
        }),
      },
    })

    // Pre-tx expectedRevision mismatch rejects immediately
    await expect(
      dynamoPutSchemaVersion(v2Doc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'bob',
        expectedVersion: 1,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    // Post-tx cancel with expectedRevision bound rejects immediately without retrying
    const boundCancelDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        return key.PK === 'SCHEMA_REGISTRY' ? { Item: { revision: 2 } } : {}
      }
      throw canceledError()
    })
    await expect(
      dynamoPutSchemaVersion(boundCancelDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'bob',
        expectedVersion: 0,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    // Pre-tx deprecated & version mismatch checks
    const deprecatedDoc = mockDoc((command) => {
      const key = command.input.Key as { PK: string }
      if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
      return { Item: { ...HEAD_A, deprecatedAt: '2026-01-02T00:00:00.000Z', deprecatedBy: 'bob' } }
    })
    await expect(
      dynamoPutSchemaVersion(deprecatedDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'schema_deprecated' })

    const mismatchDoc = mockDoc((command) => {
      const key = command.input.Key as { PK: string }
      if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
      return { Item: { ...HEAD_A, latestVersion: 2 } }
    })
    await expect(
      dynamoPutSchemaVersion(mismatchDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    const missingHeadDoc = mockDoc(() => ({}))
    await expect(
      dynamoPutSchemaVersion(missingHeadDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    // Post-tx race: deprecated or version moved
    let postRaceCalls = 0
    const postDepRaceDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 1 } }
        postRaceCalls += 1
        return postRaceCalls === 1
          ? { Item: HEAD_A }
          : { Item: { ...HEAD_A, deprecatedAt: '2026-01-02T00:00:00.000Z', deprecatedBy: 'bob' } }
      }
      throw canceledError()
    })
    await expect(
      dynamoPutSchemaVersion(postDepRaceDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'schema_deprecated' })

    const postConflictDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 1 } }
        return { Item: HEAD_A }
      }
      throw canceledError()
    })
    await expect(
      dynamoPutSchemaVersion(postConflictDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    // Exhausted retries
    const alwaysCanceledDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') return {}
      throw canceledError()
    })
    await expect(
      dynamoPutSchemaVersion(alwaysCanceledDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    // Non-TransactionCanceledException bubbles
    const fatalDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') return {}
      throw new Error('boom')
    })
    await expect(
      dynamoPutSchemaVersion(fatalDoc, 'T', NOW, {
        id: 'a',
        schema: { type: 'object' },
        actor: 'alice',
        expectedVersion: 0,
      }),
    ).rejects.toThrow('boom')
  })

  it('deprecates schemas, retries contention, handles idempotency, and propagates errors', async () => {
    let attempts = 0
    const doc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 1 } }
        return { Item: HEAD_A }
      }
      attempts += 1
      if (attempts === 1) throw canceledError()
      return {}
    })
    const dep = await dynamoDeprecateSchema(doc, 'T', NOW, 'a', 'bob')
    expect(dep.alreadyDeprecated).toBe(false)
    expect(dep.revision).toBe(2)

    const missingDoc = mockDoc(() => ({}))
    await expect(dynamoDeprecateSchema(missingDoc, 'T', NOW, 'a', 'bob')).rejects.toMatchObject({
      code: 'schema_not_found',
    })

    const alreadyDoc = mockDoc((command) => {
      const key = command.input.Key as { PK: string }
      if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
      return {
        Item: { ...HEAD_A, deprecatedAt: '2026-01-01T00:00:00.000Z', deprecatedBy: 'alice' },
      }
    })
    const already = await dynamoDeprecateSchema(alreadyDoc, 'T', NOW, 'a', 'bob')
    expect(already.alreadyDeprecated).toBe(true)
    expect(already.revision).toBe(2)

    const exhaustDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        return key.PK === 'SCHEMA_REGISTRY' ? { Item: { revision: 1 } } : { Item: HEAD_A }
      }
      throw canceledError()
    })
    await expect(dynamoDeprecateSchema(exhaustDoc, 'T', NOW, 'a', 'bob')).rejects.toMatchObject({
      code: 'schema_conflict',
    })

    const fatalDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        return key.PK === 'SCHEMA_REGISTRY' ? { Item: { revision: 1 } } : { Item: HEAD_A }
      }
      throw new Error('fatal')
    })
    await expect(dynamoDeprecateSchema(fatalDoc, 'T', NOW, 'a', 'bob')).rejects.toThrow('fatal')
  })
})
