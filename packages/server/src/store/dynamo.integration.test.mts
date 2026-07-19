import { randomUUID } from 'node:crypto'
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDynamoStore } from './dynamo.mjs'
import type { BlackboardStore } from './store.mjs'

const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const TABLE_NAME = 'AgentBlackboardIntegrationTest'

async function ensureTable(client: DynamoDBClient): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    )
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error
  }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

describe.skipIf(!ENDPOINT)('DynamoDB Local session/entry integration', () => {
  let store: BlackboardStore

  beforeAll(async () => {
    if (!ENDPOINT) throw new Error('DYNAMODB_ENDPOINT must be set')
    const client = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    })
    await ensureTable(client)
    store = createDynamoStore({
      client: DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
      }),
      tableName: TABLE_NAME,
    })
  })

  it('round-trips root/child sessions and timestamp-keyed entries', async () => {
    const credId = randomUUID()
    const rootId = randomUUID()
    const childId = randomUUID()
    await store.createSession({ credId, id: rootId, parentSessionId: null })
    const child = await store.createSession({ credId, id: childId, parentSessionId: rootId })
    expect(child.parentSessionId).toBe(rootId)
    const first = await store.appendEntry({ credId, sessionId: childId, data: { a: 1 } })
    const second = await store.appendEntry({ credId, sessionId: childId, data: { b: 2 } })
    expect(first.createdAt).not.toBe(second.createdAt)
    expect(await collect(store.getEntries(credId, childId))).toEqual([first, second])
    const patched = await store.patchEntry(credId, {
      sessionId: childId,
      createdAt: first.createdAt,
      data: { pr: 7 },
    })
    expect(patched.data).toEqual({ a: 1, pr: 7 })
    expect(await collect(store.listSessions(credId))).toHaveLength(2)
  })

  it('enforces parent existence and session archival', async () => {
    const credId = randomUUID()
    await expect(
      store.createSession({ credId, id: 'child', parentSessionId: 'missing' }),
    ).rejects.toMatchObject({ code: 'parent_not_found' })
    await store.createSession({ credId, id: 'root', parentSessionId: null })
    await store.archiveSession(credId, 'root')
    await expect(store.appendEntry({ credId, sessionId: 'root', data: {} })).rejects.toMatchObject({
      code: 'session_archived',
    })
    await expect(
      store.createSession({ credId, id: 'child', parentSessionId: 'root' }),
    ).rejects.toMatchObject({ code: 'parent_archived' })
  })

  it('round-trips credential management', async () => {
    const created = await store.createCredential(`test-${randomUUID()}`)
    expect(created.token).toMatch(/^abb_sk_/)
    expect(await store.getCredentialById(created.record.id)).toEqual(created.record)
    expect(await store.deleteCredential({ id: created.record.id })).toBe(true)
  })
})
