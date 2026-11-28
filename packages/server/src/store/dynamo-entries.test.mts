import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { dynamoAppendEntry, dynamoGetEntries, itemToEntry } from './dynamo-entries.mjs'
import type { RetentionPolicy } from './retention.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const NOW = new Date('2026-01-01T00:00:00.000Z')
const TTL_DAYS = 30
const RETENTION: RetentionPolicy = { ttlDays: TTL_DAYS, ttlOverrides: new Map() }
const EXPECTED_EXPIRES_AT = new Date(
  (Math.floor(NOW.getTime() / 1000) + TTL_DAYS * 86400) * 1000,
).toISOString()
const session = (archivedAt?: string, data: Record<string, unknown> = {}) => ({
  id: 's',
  parentSessionId: null,
  createdAt: NOW.toISOString(),
  lastEntryAt: null,
  data,
  ...(archivedAt ? { archivedAt } : {}),
})
const entry = (createdAt = NOW.toISOString()) => ({
  PK: 'ENTRIES#c#s',
  SK: `ENTRY#${createdAt}`,
  sessionId: 's',
  createdAt,
  data: { a: 1 },
  ttl: 1,
})
const canceled = () =>
  Object.assign(new Error('canceled'), { name: 'TransactionCanceledException' })

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

describe('DynamoDB entries', () => {
  it('maps entries and atomically appends with lastEntryAt and age-based ttl', async () => {
    expect(itemToEntry(entry())).toEqual({
      sessionId: 's',
      createdAt: NOW.toISOString(),
      data: { a: 1 },
      expiresAt: '1970-01-01T00:00:01.000Z',
    })
    expect(itemToEntry({ ...entry(), ttl: undefined })).toEqual({
      sessionId: 's',
      createdAt: NOW.toISOString(),
      data: { a: 1 },
    })
    expect(itemToEntry({ ...entry(), schemaId: 'finding', schemaVersion: 2 })).toEqual({
      sessionId: 's',
      createdAt: NOW.toISOString(),
      data: { a: 1 },
      schemaId: 'finding',
      schemaVersion: 2,
      expiresAt: '1970-01-01T00:00:01.000Z',
    })
    let input: Record<string, unknown> | undefined
    const doc = client((command) => {
      input = command.input
      return {}
    })
    await expect(
      dynamoAppendEntry(doc, 'T', RETENTION, () => NOW, {
        credId: 'c',
        sessionId: 's',
        data: {},
        schemaId: 'finding',
        schemaVersion: 1,
      }),
    ).resolves.toEqual({
      sessionId: 's',
      createdAt: NOW.toISOString(),
      data: {},
      schemaId: 'finding',
      schemaVersion: 1,
      expiresAt: EXPECTED_EXPIRES_AT,
    })
    const operations = input!.TransactItems as Array<{
      Update?: Record<string, unknown>
      Put?: { Item: Record<string, unknown> }
    }>
    expect(operations[0]!.Update).toMatchObject({
      UpdateExpression: 'SET lastEntryAt = :createdAt',
      ExpressionAttributeValues: { ':createdAt': NOW.toISOString() },
    })
    expect(operations[1]!.Put!.Item).toMatchObject({ PK: 'ENTRIES#c#s' })
    expect(operations[1]!.Put!.Item.ttl).toBe(Math.floor(NOW.getTime() / 1000) + TTL_DAYS * 86400)
    expect(operations[1]!.Put!.Item).not.toHaveProperty('expiresAt')
  })

  it('applies per-repository TTL overrides from session data before writing', async () => {
    const policy: RetentionPolicy = {
      ttlDays: 90,
      ttlOverrides: new Map([['org/short', 7]]),
    }
    let txInput: Record<string, unknown> | undefined
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') {
        return {
          Item: {
            ...session(undefined, { repository: 'org/short' }),
            lastEntryAt: NOW.toISOString(),
          },
        }
      }
      txInput = command.input
      return {}
    })
    const result = await dynamoAppendEntry(doc, 'T', policy, () => NOW, {
      credId: 'c',
      sessionId: 's',
      data: { note: 'override' },
    })
    const expectedTs = NOW.getTime() + 1
    const expectedTtl = Math.floor(expectedTs / 1000) + 7 * 86400
    expect(result.createdAt).toBe(new Date(expectedTs).toISOString())
    expect(result.expiresAt).toBe(new Date(expectedTtl * 1000).toISOString())
    const operations = txInput!.TransactItems as Array<{ Put?: { Item: Record<string, unknown> } }>
    expect(operations[1]!.Put!.Item.ttl).toBe(expectedTtl)
  })

  it('retries timestamp collisions and advances past the stored lastEntryAt', async () => {
    let transaction = 0
    const retry = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand' && transaction++ === 0)
        throw canceled()
      if (command.constructor.name === 'GetCommand') return { Item: session() }
      return {}
    })
    const result = await dynamoAppendEntry(retry, 'T', RETENTION, () => NOW, {
      credId: 'c',
      sessionId: 's',
      data: {},
    })
    expect(result.createdAt).toBe('2026-01-01T00:00:00.001Z')

    let futureTransaction = 0
    const future = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand' && futureTransaction++ === 0) {
        throw canceled()
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: { ...session('archived'), lastEntryAt: '2026-01-01T00:00:01.000Z' } }
      }
      return {}
    })
    const afterFuture = await dynamoAppendEntry(future, 'T', RETENTION, () => NOW, {
      credId: 'c',
      sessionId: 's',
      data: {},
    })
    expect(afterFuture.createdAt).toBe('2026-01-01T00:00:01.001Z')

    const missing = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand') throw canceled()
      return {}
    })
    await expect(
      dynamoAppendEntry(missing, 'T', RETENTION, () => NOW, {
        credId: 'c',
        sessionId: 's',
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' })
  })

  it('surfaces non-transaction errors and timestamp exhaustion', async () => {
    await expect(
      dynamoAppendEntry(
        client(() => {
          throw new Error('boom')
        }),
        'T',
        RETENTION,
        () => NOW,
        { credId: 'c', sessionId: 's', data: {} },
      ),
    ).rejects.toThrow('boom')
    let attempts = 0
    const exhausted = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand') {
        attempts++
        throw canceled()
      }
      return { Item: session() }
    })
    await expect(
      dynamoAppendEntry(exhausted, 'T', RETENTION, () => NOW, {
        credId: 'c',
        sessionId: 's',
        data: {},
      }),
    ).rejects.toMatchObject({
      code: 'timestamp_exhausted',
      message: expect.stringContaining('unique timestamp'),
    })
    expect(attempts).toBe(100)
  })

  it('requires an existing session, allows archived reads, and paginates', async () => {
    await expect(
      collect(
        dynamoGetEntries(
          client(() => ({})),
          'T',
          'c',
          's',
        ),
      ),
    ).rejects.toMatchObject({ code: 'session_not_found' })
    let query = 0
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return { Item: session() }
      query += 1
      return query === 1 ? { Items: [entry()], LastEvaluatedKey: { PK: 'p', SK: 's' } } : {}
    })
    expect(await collect(dynamoGetEntries(doc, 'T', 'c', 's'))).toHaveLength(1)
    expect(query).toBe(2)
    expect(
      await collect(
        dynamoGetEntries(
          client((command) =>
            command.constructor.name === 'GetCommand' ? { Item: session('later') } : {},
          ),
          'T',
          'c',
          's',
        ),
      ),
    ).toEqual([])
  })

  it('avoids a duplicate session lookup when the caller already verified it', async () => {
    const seen: string[] = []
    const doc = client((command) => {
      seen.push(command.constructor.name)
      return {}
    })
    await expect(
      collect(dynamoGetEntries(doc, 'T', 'c', 's', { sessionVerified: true })),
    ).resolves.toEqual([])
    expect(seen).toEqual(['QueryCommand'])
  })
})
