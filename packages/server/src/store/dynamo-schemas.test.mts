import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { dynamoPromoteSchemaVersion } from './dynamo-schemas-promote.mjs'
import {
  dynamoGetSchema,
  dynamoGetSchemaBundle,
  dynamoGetSchemaRegistryRevision,
  dynamoListSchemaVersions,
  dynamoListSchemas,
} from './dynamo-schemas-read.mjs'
import {
  dynamoGetSchemaShadowReport,
  dynamoRecordSchemaShadowFailure,
} from './dynamo-schemas-shadow.mjs'
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
    expect(await dynamoGetSchema(doc, 'T', 'a'.repeat(1020))).toBeUndefined()

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

    // ValidationError or ThrottlingError inside TransactionCanceledException is rethrown without retry
    for (const code of ['ValidationError', 'ThrottlingError']) {
      const nonRetryableErr = Object.assign(canceledError(), {
        CancellationReasons: [{ Code: 'None' }, { Code: code }],
      })
      const failDoc = mockDoc((command) => {
        if (command.constructor.name === 'GetCommand') return {}
        throw nonRetryableErr
      })
      await expect(
        dynamoPutSchemaVersion(failDoc, 'T', NOW, {
          id: 'a',
          schema: { type: 'object' },
          actor: 'alice',
          expectedVersion: 0,
        }),
      ).rejects.toBe(nonRetryableErr)
    }

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

    let alreadyRevReads = 0
    const alreadyDoc = mockDoc((command) => {
      const key = command.input.Key as { PK: string }
      if (key.PK === 'SCHEMA_REGISTRY') {
        alreadyRevReads += 1
        return { Item: { revision: alreadyRevReads === 1 ? 1 : 2 } }
      }
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

  it('promotes shadow versions, handles idempotency/errors, and records/reads shadow reports', async () => {
    const shadowVer = { ...VER_A1, mode: 'shadow', promotedAt: null, promotedBy: null }
    let attempts = 0
    const promoteDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
        if (key.PK === 'SCHEMAS') return { Item: HEAD_A }
        return { Item: shadowVer }
      }
      attempts += 1
      if (attempts === 1) throw canceledError()
      return {}
    })
    const promoted = await dynamoPromoteSchemaVersion(promoteDoc, 'T', NOW, 'a', 1, 'bob')
    expect(promoted).toMatchObject({
      revision: 3,
      alreadyEnforced: false,
      versionRecord: { mode: 'enforced', promotedBy: 'bob' },
    })

    // Missing schema or version
    const missingDoc = mockDoc(() => ({}))
    await expect(
      dynamoPromoteSchemaVersion(missingDoc, 'T', NOW, 'a', 1, 'bob'),
    ).rejects.toMatchObject({ code: 'schema_not_found' })

    // Deprecated schema
    const depDoc = mockDoc((command) => {
      const key = command.input.Key as { PK: string }
      if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
      if (key.PK === 'SCHEMAS') {
        return { Item: { ...HEAD_A, deprecatedAt: '2026-01-01T00:00:00.000Z', deprecatedBy: 'x' } }
      }
      return { Item: shadowVer }
    })
    await expect(dynamoPromoteSchemaVersion(depDoc, 'T', NOW, 'a', 1, 'bob')).rejects.toMatchObject(
      { code: 'schema_deprecated' },
    )

    // Already enforced -> idempotent
    const enforcedDoc = mockDoc((command) => {
      const key = command.input.Key as { PK: string }
      if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 3 } }
      if (key.PK === 'SCHEMAS') return { Item: HEAD_A }
      return { Item: { ...VER_A1, mode: 'enforced' } }
    })
    const already = await dynamoPromoteSchemaVersion(enforcedDoc, 'T', NOW, 'a', 1, 'carol')
    expect(already).toMatchObject({ revision: 3, alreadyEnforced: true })

    // Contention exhaustion and fatal error
    const exhaustDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
        if (key.PK === 'SCHEMAS') return { Item: HEAD_A }
        return { Item: shadowVer }
      }
      throw canceledError()
    })
    await expect(
      dynamoPromoteSchemaVersion(exhaustDoc, 'T', NOW, 'a', 1, 'bob'),
    ).rejects.toMatchObject({ code: 'schema_conflict' })

    const fatalDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 2 } }
        if (key.PK === 'SCHEMAS') return { Item: HEAD_A }
        return { Item: shadowVer }
      }
      throw new Error('promote-boom')
    })
    await expect(dynamoPromoteSchemaVersion(fatalDoc, 'T', NOW, 'a', 1, 'bob')).rejects.toThrow(
      'promote-boom',
    )

    // Record shadow failure writes atomic counter + TTL-bearing failure item, retries TransactionConflict, and bounds details
    let recordedTx: Record<string, unknown> | undefined
    let recordAttempts = 0
    const recordDoc = mockDoc((command) => {
      recordAttempts += 1
      if (recordAttempts === 1) throw canceledError()
      recordedTx = command.input
      return {}
    })
    const oversizedDetails = Array.from({ length: 120 }, (_, i) => ({
      instancePath: `/items/${i}`,
      schemaPath: '#/properties/items/type',
      keyword: 'type',
      message: 'x'.repeat(600),
    }))
    await dynamoRecordSchemaShadowFailure(recordDoc, 'T', 30, NOW, {
      schemaId: 'a',
      schemaVersion: 1,
      sessionId: 'sess-1',
      code: 'schema_validation_failed',
      message: 'bad',
      details: oversizedDetails,
    })
    expect(recordAttempts).toBe(2)
    const items = recordedTx!.TransactItems as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    const putItem = (items[1] as { Put: { Item: Record<string, unknown> } }).Put.Item
    expect(putItem).toMatchObject({
      schemaId: 'a',
      schemaVersion: 1,
      sessionId: 'sess-1',
      code: 'schema_validation_failed',
    })
    const storedDetails = putItem.details as Array<{ message: string }>
    expect(storedDetails.length).toBeGreaterThan(0)
    expect(storedDetails.length).toBeLessThan(oversizedDetails.length)
    expect(storedDetails[0]!.message.endsWith('…')).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(storedDetails), 'utf8')).toBeLessThanOrEqual(32_768)

    // Shadow failure write exhausts retries on persistent TransactionCanceledException and rethrows non-retryable errors
    const alwaysCancelShadowDoc = mockDoc(() => {
      throw canceledError()
    })
    await expect(
      dynamoRecordSchemaShadowFailure(alwaysCancelShadowDoc, 'T', 30, NOW, {
        schemaId: 'a',
        schemaVersion: 1,
        sessionId: 'sess-1',
        code: 'schema_validation_failed',
        message: 'bad',
        details: [],
      }),
    ).rejects.toThrow('canceled')

    const fatalShadowDoc = mockDoc(() => {
      throw new Error('shadow-boom')
    })
    await expect(
      dynamoRecordSchemaShadowFailure(fatalShadowDoc, 'T', 30, NOW, {
        schemaId: 'a',
        schemaVersion: 1,
        sessionId: 'sess-1',
        code: 'schema_validation_failed',
        message: 'bad',
        details: [],
      }),
    ).rejects.toThrow('shadow-boom')

    // Shadow report: missing schema / missing version, single version (empty & populated), and multi-version merge sort
    expect(await dynamoGetSchemaShadowReport(missingDoc, 'T', 'missing')).toBeUndefined()
    expect(
      await dynamoGetSchemaShadowReport(missingDoc, 'T', 'missing', { version: 1 }),
    ).toBeUndefined()

    const reportDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string; SK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 4 } }
        if (key.PK === 'SCHEMAS') return { Item: { ...HEAD_A, latestVersion: 2 } }
        if (key.PK === 'SCHEMA_VERSIONS' && key.SK === 'SCHEMA#a#V#0000000001') {
          return { Item: shadowVer }
        }
        if (key.PK === 'SCHEMA_VERSIONS' && key.SK === 'SCHEMA#a#V#0000000002') {
          return { Item: { ...VER_A1, version: 2, mode: 'enforced' } }
        }
        if (key.PK === 'SCHEMA_SHADOW_COUNTS#a' && key.SK === 'V#0000000001') {
          return {
            Item: { schemaVersion: 1, failureCount: 2, lastFailureAt: '2026-01-01T00:00:02.000Z' },
          }
        }
        return {}
      }
      if (command.constructor.name === 'QueryCommand') {
        const values = command.input.ExpressionAttributeValues as Record<string, string>
        if (values[':pk'] === 'SCHEMA_VERSIONS') {
          return {
            Items: [
              shadowVer,
              { ...VER_A1, version: 2, mode: 'shadow' },
              { ...VER_A1, version: 3, mode: 'shadow' },
            ],
          }
        }
        if (values[':pk'] === 'SCHEMA_SHADOW_COUNTS#a') {
          return {
            Items: [
              { schemaVersion: 1, failureCount: 1, lastFailureAt: '2026-01-01T00:00:02.000Z' },
              { schemaVersion: 2, failureCount: 1, lastFailureAt: '2026-01-01T00:00:02.000Z' },
              { schemaVersion: 3, failureCount: 1, lastFailureAt: '2026-01-01T00:00:01.000Z' },
            ],
          }
        }
        if (values[':pk'] === 'SCHEMA_SHADOW_FAILURES#a#V#0000000001') {
          return {
            Items: [
              {
                schemaId: 'a',
                schemaVersion: 1,
                sessionId: 's1',
                occurredAt: '2026-01-01T00:00:02.000Z',
                code: 'schema_validation_failed',
                message: 'm1',
              },
            ],
          }
        }
        if (values[':pk'] === 'SCHEMA_SHADOW_FAILURES#a#V#0000000002') {
          return {
            Items: [
              {
                schemaId: 'a',
                schemaVersion: 2,
                sessionId: 's2',
                occurredAt: '2026-01-01T00:00:02.000Z',
                code: 'schema_validation_failed',
                message: 'm2',
                details: [],
              },
            ],
          }
        }
        return {}
      }
      throw new Error(`unexpected ${command.constructor.name}`)
    })

    const v1Report = await dynamoGetSchemaShadowReport(reportDoc, 'T', 'a', { version: 1 })
    expect(v1Report).toMatchObject({ totalFailures: 2, version: 1 })
    expect(v1Report?.recentFailures[0]?.details).toEqual([])

    const v2EmptyCount = await dynamoGetSchemaShadowReport(reportDoc, 'T', 'a', { version: 2 })
    expect(v2EmptyCount).toMatchObject({ totalFailures: 0, version: 2 })

    const allReport = await dynamoGetSchemaShadowReport(reportDoc, 'T', 'a', { limit: 1 })
    expect(allReport).toMatchObject({ totalFailures: 3, version: null })
    expect(allReport?.recentFailures).toHaveLength(1)
    expect(allReport?.recentFailures[0]?.schemaVersion).toBe(2)
    expect(allReport?.versions[2]?.lastFailureAt).toBe('2026-01-01T00:00:01.000Z')

    // Empty Items branch + pagination across LastEvaluatedKey + monotonic lastFailureAt
    let pageCalls = 0
    const paginatedShadowDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string; SK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 1 } }
        if (key.PK === 'SCHEMAS') return { Item: HEAD_A }
        if (key.PK === 'SCHEMA_VERSIONS') return { Item: shadowVer }
        if (key.PK === 'SCHEMA_SHADOW_COUNTS#a') {
          return {
            Item: { schemaVersion: 1, failureCount: 2, lastFailureAt: '2026-01-01T00:00:01.000Z' },
          }
        }
        return {}
      }
      pageCalls += 1
      return pageCalls === 1
        ? {
            Items: [
              {
                schemaId: 'a',
                schemaVersion: 1,
                sessionId: 's2',
                occurredAt: '2026-01-01T00:00:05.000Z',
                code: 'schema_validation_failed',
                message: 'newer',
                details: [],
              },
            ],
            LastEvaluatedKey: { PK: 'SCHEMA_SHADOW_FAILURES#a#V#0000000001', SK: 'k1' },
          }
        : {
            Items: [
              {
                schemaId: 'a',
                schemaVersion: 1,
                sessionId: 's1',
                occurredAt: '2026-01-01T00:00:01.000Z',
                code: 'schema_validation_failed',
                message: 'older',
                details: [],
              },
            ],
          }
    })
    const paginated = await dynamoGetSchemaShadowReport(paginatedShadowDoc, 'T', 'a', {
      version: 1,
      limit: 2,
    })
    expect(paginated?.recentFailures).toHaveLength(2)
    expect(paginated?.versions[0]?.lastFailureAt).toBe('2026-01-01T00:00:05.000Z')

    // Empty Items branch in queryRecentFailures (and count without recent items covers maxIso(a, null))
    const emptyFailuresDoc = mockDoc((command) => {
      if (command.constructor.name === 'GetCommand') {
        const key = command.input.Key as { PK: string }
        if (key.PK === 'SCHEMA_REGISTRY') return { Item: { revision: 1 } }
        if (key.PK === 'SCHEMAS') return { Item: HEAD_A }
        if (key.PK === 'SCHEMA_VERSIONS') return { Item: shadowVer }
        if (key.PK === 'SCHEMA_SHADOW_COUNTS#a') {
          return {
            Item: { schemaVersion: 1, failureCount: 1, lastFailureAt: '2026-01-01T00:00:01.000Z' },
          }
        }
        return {}
      }
      return {}
    })
    const expiredReport = await dynamoGetSchemaShadowReport(emptyFailuresDoc, 'T', 'a', {
      version: 1,
    })
    expect(expiredReport?.recentFailures).toEqual([])
    expect(expiredReport?.versions[0]?.lastFailureAt).toBe('2026-01-01T00:00:01.000Z')
  })
})
