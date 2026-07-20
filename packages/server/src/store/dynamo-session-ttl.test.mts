import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { fanOutEntryTtl } from './dynamo-session-ttl.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

describe('fanOutEntryTtl', () => {
  it('issues a single empty Query and no updates when a session has no entries', async () => {
    let calls = 0
    const doc = client((command) => {
      calls += 1
      if (command.constructor.name === 'QueryCommand') return {}
      throw new Error(`unexpected ${command.constructor.name}`)
    })
    await fanOutEntryTtl(doc, 'T', 'c', 's', 123)
    expect(calls).toBe(1)
  })

  it('sets ttl on every entry across paginated Query results', async () => {
    const updates: Record<string, unknown>[] = []
    let query = 0
    const doc = client((command) => {
      if (command.constructor.name === 'QueryCommand') {
        query += 1
        return query === 1
          ? {
              Items: [{ PK: 'ENTRIES#c#s', SK: 'ENTRY#a' }],
              LastEvaluatedKey: { PK: 'ENTRIES#c#s', SK: 'ENTRY#a' },
            }
          : { Items: [{ PK: 'ENTRIES#c#s', SK: 'ENTRY#b' }] }
      }
      if (command.constructor.name === 'UpdateCommand') {
        updates.push(command.input)
        return {}
      }
      throw new Error(`unexpected ${command.constructor.name}`)
    })

    await fanOutEntryTtl(doc, 'T', 'c', 's', 123)

    expect(query).toBe(2)
    expect(updates).toEqual([
      {
        TableName: 'T',
        Key: { PK: 'ENTRIES#c#s', SK: 'ENTRY#a' },
        UpdateExpression: 'SET #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ttl': 123 },
      },
      {
        TableName: 'T',
        Key: { PK: 'ENTRIES#c#s', SK: 'ENTRY#b' },
        UpdateExpression: 'SET #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ttl': 123 },
      },
    ])
  })
})
