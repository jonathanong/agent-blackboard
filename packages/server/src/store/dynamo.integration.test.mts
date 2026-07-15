import { randomUUID } from 'node:crypto'
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDynamoStore } from './dynamo.mjs'
import type { JournalStore } from './store.mjs'

// Real integration test against DynamoDB Local. Skips cleanly when no local
// endpoint is configured (see CLAUDE.md / CI: DYNAMODB_ENDPOINT is set by a
// `dynamodb-local` service container). Run locally with e.g.
//   docker run -p 8000:8000 amazon/dynamodb-local -jar DynamoDBLocal.jar -inMemory -sharedDb
//   DYNAMODB_ENDPOINT=http://localhost:8000 pnpm exec vitest run packages/server/src/store/dynamo.integration.test.mts
const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const TABLE_NAME = 'AgentJournalIntegrationTest'

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

describe.skipIf(!ENDPOINT)('createDynamoStore (DynamoDB Local integration)', () => {
  let store: JournalStore

  beforeAll(async () => {
    // Guaranteed set: this whole describe block is skipped otherwise (see
    // `describe.skipIf`) — the check just satisfies TypeScript's narrowing.
    if (!ENDPOINT) throw new Error('DYNAMODB_ENDPOINT must be set to run this test')
    const client = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    })
    await ensureTable(client)
    const doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    })
    store = createDynamoStore({ client: doc, tableName: TABLE_NAME })
  })

  it('round-trips append -> get -> patch (merging into empty data) -> get(archived)', async () => {
    // A fresh credId per test isolates data within the shared table (the
    // container is disposable/in-memory in CI, but this also makes the test
    // safe to re-run against a persistent local instance).
    const credId = randomUUID()
    const sessionId = randomUUID()

    const entry = await store.appendEntry({ credId, sessionId, agent: 'claude', data: {} })
    expect(entry.archived).toBe(false)
    expect(entry.data).toEqual({})

    const bySession = []
    for await (const e of store.getEntries(credId, { sessionId })) bySession.push(e)
    expect(bySession).toEqual([entry])

    const allSessions = []
    for await (const e of store.getEntries(credId, {})) allSessions.push(e)
    expect(allSessions).toEqual([entry])

    // Merge into a previously-empty data blob — this specifically exercises
    // the nested `SET #data.#dk0 = :dv0` UpdateExpression against a real
    // DynamoDB, which a hand-rolled unit-test mock can't validate.
    const [patched] = await store.patchEntries(credId, [
      { id: entry.id, archived: true, data: { pr: 7777 } },
    ])
    expect(patched?.archived).toBe(true)
    expect(patched?.data).toEqual({ pr: 7777 })

    const [mergedAgain] = await store.patchEntries(credId, [{ id: entry.id, data: { note: 'hi' } }])
    expect(mergedAgain?.data).toEqual({ pr: 7777, note: 'hi' })

    const archived = []
    for await (const e of store.getEntries(credId, { archived: true })) archived.push(e)
    expect(archived).toHaveLength(1)

    const active = []
    for await (const e of store.getEntries(credId, { archived: false })) active.push(e)
    expect(active).toHaveLength(0)
  })

  it('returns undefined for patching an id that does not exist (no upsert)', async () => {
    const credId = randomUUID()
    const results = await store.patchEntries(credId, [{ id: 'does-not-exist', archived: true }])
    expect(results).toEqual([])
    const entries = []
    for await (const e of store.getEntries(credId, {})) entries.push(e)
    expect(entries).toEqual([])
  })

  it('paginates across many entries in one session', async () => {
    const credId = randomUUID()
    const sessionId = randomUUID()
    const count = 25
    for (let i = 0; i < count; i++) {
      await store.appendEntry({ credId, sessionId, agent: 'claude', data: { i } })
    }
    const entries = []
    for await (const e of store.getEntries(credId, { sessionId })) entries.push(e)
    expect(entries).toHaveLength(count)
  })

  it('round-trips credential creation, lookup, listing, and deletion', async () => {
    const name = `test-${randomUUID()}`
    const { record, token } = await store.createCredential(name)
    expect(token.startsWith('ag_sk_')).toBe(true)

    const fetched = await store.getCredentialById(record.id)
    expect(fetched).toEqual(record)

    const listed = await store.listCredentials()
    expect(listed.some((c) => c.id === record.id)).toBe(true)

    expect(await store.deleteCredential({ id: record.id })).toBe(true)
    expect(await store.getCredentialById(record.id)).toBeUndefined()
  })
})
