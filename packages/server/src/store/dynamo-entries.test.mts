import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { dynamoAppendEntry, dynamoGetEntries, itemToEntry } from './dynamo-entries.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const NOW = new Date('2026-01-01T00:00:00.000Z')
const session = (archivedAt?: string) => ({
  id: 's',
  parentSessionId: null,
  createdAt: NOW.toISOString(),
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
  it('maps entries and appends with an active-session transaction, without a ttl', async () => {
    expect(itemToEntry(entry())).toEqual({
      sessionId: 's',
      createdAt: NOW.toISOString(),
      data: { a: 1 },
    })
    let input: Record<string, unknown> | undefined
    const doc = client((command) => {
      input = command.input
      return {}
    })
    await expect(
      dynamoAppendEntry(doc, 'T', () => NOW, { credId: 'c', sessionId: 's', data: {} }),
    ).resolves.toEqual({ sessionId: 's', createdAt: NOW.toISOString(), data: {} })
    const operations = input!.TransactItems as Array<{ Put?: { Item: Record<string, unknown> } }>
    expect(operations[1]!.Put!.Item).toMatchObject({ PK: 'ENTRIES#c#s' })
    expect(operations[1]!.Put!.Item).not.toHaveProperty('ttl')
  })

  it('retries timestamp collisions and diagnoses missing/archived sessions', async () => {
    let transaction = 0
    const retry = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand' && transaction++ === 0)
        throw canceled()
      if (command.constructor.name === 'GetCommand') return { Item: session() }
      return {}
    })
    const result = await dynamoAppendEntry(retry, 'T', () => NOW, {
      credId: 'c',
      sessionId: 's',
      data: {},
    })
    expect(result.createdAt).toBe('2026-01-01T00:00:00.001Z')

    for (const [itemValue, code] of [
      [undefined, 'session_not_found'],
      [session('later'), 'session_archived'],
    ] as const) {
      const doc = client((command) => {
        if (command.constructor.name === 'TransactWriteCommand') throw canceled()
        return itemValue ? { Item: itemValue } : {}
      })
      await expect(
        dynamoAppendEntry(doc, 'T', () => NOW, { credId: 'c', sessionId: 's', data: {} }),
      ).rejects.toMatchObject({ code })
    }
  })

  it('surfaces non-transaction errors and timestamp exhaustion', async () => {
    await expect(
      dynamoAppendEntry(
        client(() => {
          throw new Error('boom')
        }),
        'T',
        () => NOW,
        { credId: 'c', sessionId: 's', data: {} },
      ),
    ).rejects.toThrow('boom')
    const exhausted = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand') throw canceled()
      return { Item: session() }
    })
    await expect(
      dynamoAppendEntry(exhausted, 'T', () => NOW, { credId: 'c', sessionId: 's', data: {} }),
    ).rejects.toMatchObject({
      code: 'timestamp_exhausted',
      message: expect.stringContaining('unique timestamp'),
    })
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
})
