import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDynamoStore } from './dynamo.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const NOW = new Date('2026-01-01T00:00:00.000Z')
const session = {
  id: 's',
  parentSessionId: null,
  agent: 'test-agent',
  version: '1.0.0',
  createdAt: NOW.toISOString(),
  archivedAt: null,
  data: {},
}
const entry = { sessionId: 's', createdAt: NOW.toISOString(), data: {} }

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

describe('createDynamoStore wiring', () => {
  it('delegates every session and entry operation', async () => {
    let getCount = 0
    let entryTtlUpdateCount = 0
    const doc = client((command) => {
      if (command.constructor.name === 'PutCommand') return {}
      if (command.constructor.name === 'UpdateCommand') {
        const key = command.input.Key as { PK: string }
        // archiveSession fans ttl onto every entry (see dynamo-session-ttl.mts)
        // before flipping archivedAt on the session itself — this branch
        // proves the QueryCommand mock's one entry below actually drives a
        // per-entry UpdateItem, not just the final session UpdateItem.
        if (key.PK.startsWith('ENTRIES')) entryTtlUpdateCount += 1
        return { Attributes: { ...session, archivedAt: 'later' } }
      }
      if (command.constructor.name === 'TransactWriteCommand') return {}
      if (command.constructor.name === 'GetCommand') {
        getCount += 1
        const key = command.input.Key as { PK: string }
        if (key.PK.startsWith('ENTRIES'))
          return { Item: { ...entry, PK: key.PK, SK: `ENTRY#${entry.createdAt}` } }
        return { Item: session }
      }
      if (command.constructor.name === 'QueryCommand') {
        const values = command.input.ExpressionAttributeValues as Record<string, string>
        return values[':pk']?.startsWith('SESSIONS')
          ? { Items: [session] }
          : { Items: [{ ...entry, PK: values[':pk'], SK: `ENTRY#${entry.createdAt}` }] }
      }
      throw new Error(`unexpected ${command.constructor.name}`)
    })
    const store = createDynamoStore({ client: doc, tableName: 'T', now: () => NOW })
    await expect(
      store.createSession({
        credId: 'c',
        id: 's',
        parentSessionId: null,
        agent: 'test-agent',
        version: '1.0.0',
      }),
    ).resolves.toMatchObject({ id: 's' })
    await expect(store.getSession('c', 's')).resolves.toMatchObject({ id: 's' })
    await expect(store.listSessions('c')).resolves.toMatchObject({ sessions: [session] })
    await expect(
      store.patchSession('c', { sessionId: 's', data: { branch: 'main' } }),
    ).resolves.toMatchObject({ id: 's' })
    await expect(store.archiveSession('c', 's')).resolves.toMatchObject({ archivedAt: 'later' })
    expect(entryTtlUpdateCount).toBe(1)
    await expect(store.appendEntry({ credId: 'c', sessionId: 's', data: {} })).resolves.toEqual(
      entry,
    )
    await expect(collect(store.getEntries('c', 's'))).resolves.toEqual([entry])
    expect(getCount).toBeGreaterThan(0)
  })
})

describe('DynamoDB credentials', () => {
  it('creates, gets, lists, and deletes credentials', async () => {
    let query = 0
    const raw = { id: 'a', name: 'target', tokenHash: 'hash', createdAt: 'now' }
    const doc = client((command) => {
      if (command.constructor.name === 'PutCommand') return {}
      if (command.constructor.name === 'GetCommand') return { Item: raw }
      if (command.constructor.name === 'QueryCommand') {
        query += 1
        return query === 1
          ? { Items: [raw], LastEvaluatedKey: { PK: 'CRED', SK: 'a' } }
          : { Items: [] }
      }
      if (command.constructor.name === 'DeleteCommand') return { Attributes: raw }
      throw new Error('unexpected command')
    })
    const store = createDynamoStore({ client: doc, tableName: 'T', now: () => NOW })
    expect((await store.createCredential('target')).token).toMatch(/^abb_sk_/)
    expect(await store.getCredentialById('a')).toEqual(raw)
    expect(await store.listCredentials()).toEqual([raw])
    expect(await store.deleteCredential({ id: 'a' })).toBe(true)
  })

  it('handles missing credentials and name deletion branches', async () => {
    const missing = createDynamoStore({ client: client(() => ({})), tableName: 'T' })
    expect(await missing.getCredentialById('x')).toBeUndefined()
    expect(await missing.listCredentials()).toEqual([])
    expect(await missing.deleteCredential({ id: 'x' })).toBe(false)
    expect(await missing.deleteCredential({ name: 'x' })).toBe(false)
    expect(await missing.deleteCredential({})).toBe(false)

    const raw = { id: 'a', name: 'target', tokenHash: 'h', createdAt: 'now' }
    const byName = createDynamoStore({
      client: client((command) =>
        command.constructor.name === 'QueryCommand'
          ? { Items: [raw, { ...raw, id: 'b' }, { ...raw, id: 'c', name: 'other' }] }
          : { Attributes: raw },
      ),
      tableName: 'T',
    })
    expect(await byName.deleteCredential({ name: 'target' })).toBe(true)
  })
})

describe('Dynamo config', () => {
  const originalTable = process.env.AGENT_BLACKBOARD_TABLE
  const originalTtl = process.env.AGENT_BLACKBOARD_TTL_DAYS

  beforeEach(() => {
    delete process.env.AGENT_BLACKBOARD_TABLE
    delete process.env.AGENT_BLACKBOARD_TTL_DAYS
  })

  afterEach(() => {
    if (originalTable === undefined) delete process.env.AGENT_BLACKBOARD_TABLE
    else process.env.AGENT_BLACKBOARD_TABLE = originalTable
    if (originalTtl === undefined) delete process.env.AGENT_BLACKBOARD_TTL_DAYS
    else process.env.AGENT_BLACKBOARD_TTL_DAYS = originalTtl
  })

  it('constructs defaults and reads table/ttl environment values', async () => {
    const defaults = createDynamoStore({ client: client(() => ({})) })
    await defaults.createCredential('uses-default-clock')
    process.env.AGENT_BLACKBOARD_TABLE = 'FromEnv'
    process.env.AGENT_BLACKBOARD_TTL_DAYS = '45'
    let seen: Record<string, unknown> | undefined
    const store = createDynamoStore({
      client: client((command) => {
        seen = command.input
        return {}
      }),
      now: () => NOW,
    })
    await store.appendEntry({ credId: 'c', sessionId: 's', data: {} })
    const items = seen!.TransactItems as Array<{ ConditionCheck?: { TableName?: string } }>
    expect(items[0]?.ConditionCheck?.TableName).toBe('FromEnv')
  })
})
