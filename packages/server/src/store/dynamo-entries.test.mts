import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import {
  dynamoAppendEntry,
  dynamoGetEntries,
  dynamoPatchEntry,
  itemToEntry,
} from './dynamo-entries.mjs'

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
  it('maps entries and appends with an active-session transaction and ttl', async () => {
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
      dynamoAppendEntry(doc, 'T', 10, () => NOW, { credId: 'c', sessionId: 's', data: {} }),
    ).resolves.toEqual({ sessionId: 's', createdAt: NOW.toISOString(), data: {} })
    const operations = input!.TransactItems as Array<{ Put?: { Item: Record<string, unknown> } }>
    expect(operations[1]!.Put!.Item).toMatchObject({ PK: 'ENTRIES#c#s', ttl: 1768089600 })
  })

  it('retries timestamp collisions and diagnoses missing/archived sessions', async () => {
    let transaction = 0
    const retry = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand' && transaction++ === 0)
        throw canceled()
      if (command.constructor.name === 'GetCommand') return { Item: session() }
      return {}
    })
    const result = await dynamoAppendEntry(retry, 'T', 1, () => NOW, {
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
        dynamoAppendEntry(doc, 'T', 1, () => NOW, { credId: 'c', sessionId: 's', data: {} }),
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
        1,
        () => NOW,
        { credId: 'c', sessionId: 's', data: {} },
      ),
    ).rejects.toThrow('boom')
    const exhausted = client((command) => {
      if (command.constructor.name === 'TransactWriteCommand') throw canceled()
      return { Item: session() }
    })
    await expect(
      dynamoAppendEntry(exhausted, 'T', 1, () => NOW, { credId: 'c', sessionId: 's', data: {} }),
    ).rejects.toThrow('unique timestamp')
  })

  it('requires an active session and paginates reads', async () => {
    for (const [itemValue, code] of [
      [undefined, 'session_not_found'],
      [session('later'), 'session_archived'],
    ] as const) {
      await expect(
        collect(
          dynamoGetEntries(
            client(() => (itemValue ? { Item: itemValue } : {})),
            'T',
            'c',
            's',
          ),
        ),
      ).rejects.toMatchObject({ code })
    }
    let query = 0
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return { Item: session() }
      query += 1
      return query === 1 ? { Items: [entry()], LastEvaluatedKey: { PK: 'p', SK: 's' } } : {}
    })
    expect(await collect(dynamoGetEntries(doc, 'T', 'c', 's'))).toHaveLength(1)
    expect(query).toBe(2)
  })

  it('patches with a session condition and rejects missing entries', async () => {
    const missing = client((command) =>
      command.constructor.name === 'GetCommand' &&
      (command.input.Key as { PK: string }).PK.startsWith('SESSIONS')
        ? { Item: session() }
        : {},
    )
    await expect(
      dynamoPatchEntry(missing, 'T', 'c', { sessionId: 's', createdAt: 'now', data: {} }),
    ).rejects.toMatchObject({ code: 'entry_not_found' })

    let gets = 0
    let transaction: Record<string, unknown> | undefined
    const success = client((command) => {
      if (command.constructor.name === 'GetCommand')
        return { Item: gets++ === 0 ? session() : entry('now') }
      transaction = command.input
      return {}
    })
    await expect(
      dynamoPatchEntry(success, 'T', 'c', {
        sessionId: 's',
        createdAt: 'now',
        data: { b: 2 },
      }),
    ).resolves.toMatchObject({ data: { a: 1, b: 2 } })
    expect(transaction!.TransactItems).toHaveLength(2)
  })

  it('diagnoses archive races while patching and preserves unrelated failures', async () => {
    for (const [sessionAfterRace, expected] of [
      [undefined, 'session_not_found'],
      [session('later'), 'session_archived'],
      [session(), undefined],
    ] as const) {
      let get = 0
      const doc = client((command) => {
        if (command.constructor.name === 'GetCommand') {
          get += 1
          if (get === 1) return { Item: session() }
          if (get === 2) return { Item: entry('now') }
          return sessionAfterRace ? { Item: sessionAfterRace } : {}
        }
        throw canceled()
      })
      const result = dynamoPatchEntry(doc, 'T', 'c', {
        sessionId: 's',
        createdAt: 'now',
        data: { b: 2 },
      })
      if (expected) await expect(result).rejects.toMatchObject({ code: expected })
      else await expect(result).rejects.toThrow('canceled')
    }
    await expect(
      dynamoPatchEntry(
        client((command) => {
          if (command.constructor.name === 'GetCommand')
            return (command.input.Key as { PK: string }).PK.startsWith('SESSIONS')
              ? { Item: session() }
              : { Item: entry('now') }
          throw new Error('boom')
        }),
        'T',
        'c',
        { sessionId: 's', createdAt: 'now', data: {} },
      ),
    ).rejects.toThrow('boom')
  })
})
