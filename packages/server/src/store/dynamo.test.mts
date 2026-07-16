import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDynamoStore } from './dynamo.mjs'

// Minimal command shape our fake `send()` needs to inspect. The real SDK
// commands expose `.input` with the params we passed to the constructor.
interface FakeCommand {
  constructor: { name: string }
  input: Record<string, unknown>
}

function fakeDocClient(handle: (command: FakeCommand) => unknown): DynamoDBDocumentClient {
  return {
    send: vi.fn((command: unknown) => Promise.resolve(handle(command as FakeCommand))),
  } as unknown as DynamoDBDocumentClient
}

const FIXED_NOW = new Date('2024-06-01T00:00:00.000Z')

describe('createDynamoStore', () => {
  describe('appendEntry', () => {
    it('PUTs an item with computed id/createdAt/ttl and returns a clean TelemetryEntry', async () => {
      let putInput: Record<string, unknown> | undefined
      const client = fakeDocClient((command) => {
        if (command.constructor.name === 'PutCommand') {
          putInput = command.input
          return {}
        }
        throw new Error(`unexpected command ${command.constructor.name}`)
      })
      const store = createDynamoStore({ client, tableName: 'T', ttlDays: 10, now: () => FIXED_NOW })
      const entry = await store.appendEntry({
        credId: 'cred1',
        sessionId: 'sess1',
        agent: 'claude',
        data: { a: 1 },
      })
      expect(entry.id.startsWith('sess1#')).toBe(true)
      expect(entry.credId).toBe('cred1')
      expect(entry.ttl).toBe(Math.floor(FIXED_NOW.getTime() / 1000) + 10 * 86400)
      expect(putInput?.TableName).toBe('T')
      expect(putInput?.Item).toMatchObject({ PK: 'cred1', SK: entry.id, ...entry })
    })
  })

  describe('appendEntries', () => {
    it('writes every entry in one TransactWriteCommand, sharing one timestamp', async () => {
      let transactInput: Record<string, unknown> | undefined
      const client = fakeDocClient((command) => {
        if (command.constructor.name === 'TransactWriteCommand') {
          transactInput = command.input
          return {}
        }
        throw new Error(`unexpected command ${command.constructor.name}`)
      })
      const store = createDynamoStore({ client, tableName: 'T', ttlDays: 10, now: () => FIXED_NOW })
      const results = await store.appendEntries([
        { credId: 'cred1', sessionId: 'sess1', agent: 'claude', data: { a: 1 } },
        { credId: 'cred1', sessionId: 'sess1', agent: 'claude', data: { a: 2 } },
      ])
      expect(results).toHaveLength(2)
      expect(results[0]!.id).not.toBe(results[1]!.id)
      expect(results[0]!.createdAt).toBe(results[1]!.createdAt)
      const items = transactInput?.TransactItems as Array<{
        Put: { Item: Record<string, unknown> }
      }>
      expect(items).toHaveLength(2)
      expect(items[0]!.Put.Item).toMatchObject({ PK: 'cred1', SK: results[0]!.id })
      expect(items[1]!.Put.Item).toMatchObject({ PK: 'cred1', SK: results[1]!.id })
    })

    it('returns [] without calling the client for an empty batch', async () => {
      const send = vi.fn()
      const client = { send } as unknown as DynamoDBDocumentClient
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      await expect(store.appendEntries([])).resolves.toEqual([])
      expect(send).not.toHaveBeenCalled()
    })

    it('throws instead of calling the client for a batch over MAX_APPEND_BATCH_SIZE', async () => {
      const send = vi.fn()
      const client = { send } as unknown as DynamoDBDocumentClient
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const entries = Array.from({ length: 101 }, () => ({
        credId: 'cred1',
        sessionId: 's',
        agent: 'a',
        data: {},
      }))
      await expect(store.appendEntries(entries)).rejects.toThrow('101')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('getEntries', () => {
    function rawItem(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
      return {
        PK: 'cred1',
        SK: 'sess1#01',
        id: 'sess1#01',
        credId: 'cred1',
        sessionId: 'sess1',
        agent: 'claude',
        createdAt: '2024-01-01T00:00:00.000Z',
        archived: false,
        data: { a: 1 },
        ttl: 123,
        ...overrides,
      }
    }

    it('strips PK/SK from yielded entries', async () => {
      const client = fakeDocClient((command) => {
        expect(command.constructor.name).toBe('QueryCommand')
        return { Items: [rawItem()] }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const results = []
      for await (const entry of store.getEntries('cred1', {})) results.push(entry)
      expect(results).toEqual([
        {
          id: 'sess1#01',
          credId: 'cred1',
          sessionId: 'sess1',
          agent: 'claude',
          createdAt: '2024-01-01T00:00:00.000Z',
          archived: false,
          data: { a: 1 },
          ttl: 123,
        },
      ])
    })

    it('queries with begins_with(SK, ...) when sessionId is given', async () => {
      const client = fakeDocClient((command) => {
        expect(command.input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)')
        expect(
          (command.input.ExpressionAttributeValues as Record<string, unknown>)[':skPrefix'],
        ).toBe('sess1#')
        return { Items: [] }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const results = []
      for await (const entry of store.getEntries('cred1', { sessionId: 'sess1' }))
        results.push(entry)
      expect(results).toEqual([])
    })

    it('queries without begins_with when sessionId is not given', async () => {
      const client = fakeDocClient((command) => {
        expect(command.input.KeyConditionExpression).toBe('PK = :pk')
        return { Items: [] }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      for await (const _ of store.getEntries('cred1', {})) void _
    })

    it('builds a FilterExpression for agent and archived', async () => {
      const client = fakeDocClient((command) => {
        expect(command.input.FilterExpression).toBe('#agent = :agent AND #archived = :archived')
        expect(command.input.ExpressionAttributeNames).toEqual({
          '#agent': 'agent',
          '#archived': 'archived',
        })
        expect(command.input.ExpressionAttributeValues).toMatchObject({
          ':agent': 'claude',
          ':archived': true,
        })
        return { Items: [] }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      for await (const _ of store.getEntries('cred1', { agent: 'claude', archived: true })) void _
    })

    it('has no FilterExpression when no agent/archived filter is given', async () => {
      const client = fakeDocClient((command) => {
        expect(command.input.FilterExpression).toBeUndefined()
        expect(command.input.ExpressionAttributeNames).toBeUndefined()
        return { Items: [] }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      for await (const _ of store.getEntries('cred1', {})) void _
    })

    it('paginates via ExclusiveStartKey/LastEvaluatedKey', async () => {
      let calls = 0
      const client = fakeDocClient((command) => {
        calls += 1
        if (calls === 1) {
          expect(command.input.ExclusiveStartKey).toBeUndefined()
          return {
            Items: [rawItem({ SK: 'sess1#01', id: 'sess1#01' })],
            LastEvaluatedKey: { PK: 'cred1', SK: 'sess1#01' },
          }
        }
        expect(command.input.ExclusiveStartKey).toEqual({ PK: 'cred1', SK: 'sess1#01' })
        return { Items: [rawItem({ SK: 'sess1#02', id: 'sess1#02' })] }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const ids: string[] = []
      for await (const entry of store.getEntries('cred1', {})) ids.push(entry.id)
      expect(ids).toEqual(['sess1#01', 'sess1#02'])
      expect(calls).toBe(2)
    })

    it('treats a missing Items array as empty', async () => {
      const client = fakeDocClient(() => ({}))
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const results = []
      for await (const entry of store.getEntries('cred1', {})) results.push(entry)
      expect(results).toEqual([])
    })
  })

  describe('patchEntries', () => {
    it('merges data via per-key nested SET and returns a clean entry', async () => {
      const client = fakeDocClient((command) => {
        expect(command.constructor.name).toBe('UpdateCommand')
        expect(command.input.UpdateExpression).toBe('SET #data.#dk0 = :dv0')
        expect(command.input.ExpressionAttributeNames).toEqual({ '#data': 'data', '#dk0': 'pr' })
        expect(command.input.ExpressionAttributeValues).toEqual({ ':dv0': 7777 })
        expect(command.input.ConditionExpression).toBe('attribute_exists(PK)')
        return {
          Attributes: {
            PK: 'cred1',
            SK: 'sess1#01',
            id: 'sess1#01',
            credId: 'cred1',
            sessionId: 'sess1',
            agent: 'claude',
            createdAt: '2024-01-01T00:00:00.000Z',
            archived: false,
            data: { pr: 7777 },
            ttl: 123,
          },
        }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const [updated] = await store.patchEntries('cred1', [{ id: 'sess1#01', data: { pr: 7777 } }])
      expect(updated).toEqual({
        id: 'sess1#01',
        credId: 'cred1',
        sessionId: 'sess1',
        agent: 'claude',
        createdAt: '2024-01-01T00:00:00.000Z',
        archived: false,
        data: { pr: 7777 },
        ttl: 123,
      })
    })

    it('sets archived via a plain SET clause', async () => {
      const client = fakeDocClient((command) => {
        expect(command.input.UpdateExpression).toBe('SET #archived = :archived')
        expect(command.input.ExpressionAttributeValues).toEqual({ ':archived': true })
        return { Attributes: undefined }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const results = await store.patchEntries('cred1', [{ id: 'sess1#01', archived: true }])
      expect(results).toEqual([])
    })

    it('combines archived and multi-key data in one UpdateExpression', async () => {
      const client = fakeDocClient((command) => {
        expect(command.input.UpdateExpression).toBe(
          'SET #archived = :archived, #data.#dk0 = :dv0, #data.#dk1 = :dv1',
        )
        return { Attributes: undefined }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      await store.patchEntries('cred1', [{ id: 'sess1#01', archived: true, data: { a: 1, b: 2 } }])
    })

    it('swallows ConditionalCheckFailedException as a skipped patch', async () => {
      const client = fakeDocClient(() => {
        const error = new Error('missing') as Error & { name: string }
        error.name = 'ConditionalCheckFailedException'
        throw error
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const results = await store.patchEntries('cred1', [{ id: 'missing', archived: true }])
      expect(results).toEqual([])
    })

    it('rethrows any other error', async () => {
      const client = fakeDocClient(() => {
        throw new Error('boom')
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      await expect(store.patchEntries('cred1', [{ id: 'x', archived: true }])).rejects.toThrow(
        'boom',
      )
    })

    it('applies patches in bounded-concurrency batches, preserving result order', async () => {
      const seen: string[] = []
      const client = fakeDocClient((command) => {
        const id = (command.input.Key as { SK: string }).SK
        seen.push(id)
        return {
          Attributes: {
            PK: 'cred1',
            SK: id,
            id,
            credId: 'cred1',
            sessionId: 's',
            agent: 'a',
            createdAt: 'now',
            archived: true,
            data: {},
            ttl: 1,
          },
        }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const patches = Array.from({ length: 23 }, (_, i) => ({ id: `id${i}`, archived: true }))
      const results = await store.patchEntries('cred1', patches)
      expect(results.map((r) => r.id)).toEqual(patches.map((p) => p.id))
      expect(seen.length).toBe(23)
    })
  })

  describe('credentials', () => {
    it('creates a credential via PutCommand and returns the raw token once', async () => {
      let putInput: Record<string, unknown> | undefined
      const client = fakeDocClient((command) => {
        putInput = command.input
        return {}
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const { record, token } = await store.createCredential('agent-1')
      expect(record.name).toBe('agent-1')
      expect(token.startsWith('atl_sk_')).toBe(true)
      expect(putInput?.Item).toMatchObject({ PK: 'CRED', SK: record.id, name: 'agent-1' })
    })

    it('lists credentials, paginating and stripping PK/SK', async () => {
      let calls = 0
      const client = fakeDocClient(() => {
        calls += 1
        if (calls === 1) {
          return {
            Items: [
              { PK: 'CRED', SK: 'a', id: 'a', name: 'alpha', tokenHash: 'h1', createdAt: 'now' },
            ],
            LastEvaluatedKey: { PK: 'CRED', SK: 'a' },
          }
        }
        return {
          Items: [
            { PK: 'CRED', SK: 'b', id: 'b', name: 'beta', tokenHash: 'h2', createdAt: 'now' },
          ],
        }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      const records = await store.listCredentials()
      expect(records).toEqual([
        { id: 'a', name: 'alpha', tokenHash: 'h1', createdAt: 'now' },
        { id: 'b', name: 'beta', tokenHash: 'h2', createdAt: 'now' },
      ])
      expect(calls).toBe(2)
    })

    it('gets a credential by id, stripping PK/SK', async () => {
      const client = fakeDocClient(() => ({
        Item: { PK: 'CRED', SK: 'a', id: 'a', name: 'alpha', tokenHash: 'h1', createdAt: 'now' },
      }))
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.getCredentialById('a')).toEqual({
        id: 'a',
        name: 'alpha',
        tokenHash: 'h1',
        createdAt: 'now',
      })
    })

    it('returns undefined getting an unknown credential id', async () => {
      const client = fakeDocClient(() => ({}))
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.getCredentialById('nope')).toBeUndefined()
    })

    it('deletes a credential by id', async () => {
      const client = fakeDocClient((command) => {
        expect(command.constructor.name).toBe('DeleteCommand')
        expect(command.input.Key).toEqual({ PK: 'CRED', SK: 'a' })
        return { Attributes: { id: 'a' } }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.deleteCredential({ id: 'a' })).toBe(true)
    })

    it('returns false deleting an unknown id', async () => {
      const client = fakeDocClient(() => ({ Attributes: undefined }))
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.deleteCredential({ id: 'nope' })).toBe(false)
    })

    it('deletes a credential by name via list-then-delete', async () => {
      const calls: string[] = []
      const client = fakeDocClient((command) => {
        calls.push(command.constructor.name)
        if (command.constructor.name === 'QueryCommand') {
          return {
            Items: [
              { PK: 'CRED', SK: 'a', id: 'a', name: 'target', tokenHash: 'h', createdAt: 'now' },
            ],
          }
        }
        return { Attributes: { id: 'a' } }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.deleteCredential({ name: 'target' })).toBe(true)
      expect(calls).toEqual(['QueryCommand', 'DeleteCommand'])
    })

    it('deletes ALL credentials matching name, not just the first', async () => {
      const calls: string[] = []
      const deletedSks: string[] = []
      const client = fakeDocClient((command) => {
        calls.push(command.constructor.name)
        if (command.constructor.name === 'QueryCommand') {
          return {
            Items: [
              { PK: 'CRED', SK: 'a', id: 'a', name: 'target', tokenHash: 'h1', createdAt: 'now' },
              { PK: 'CRED', SK: 'b', id: 'b', name: 'target', tokenHash: 'h2', createdAt: 'now' },
              { PK: 'CRED', SK: 'c', id: 'c', name: 'other', tokenHash: 'h3', createdAt: 'now' },
            ],
          }
        }
        const sk = (command.input.Key as { SK: string }).SK
        deletedSks.push(sk)
        return { Attributes: { id: sk } }
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.deleteCredential({ name: 'target' })).toBe(true)
      expect(calls).toEqual(['QueryCommand', 'DeleteCommand', 'DeleteCommand'])
      expect(deletedSks.sort()).toEqual(['a', 'b'])
    })

    it('returns false deleting an unknown name', async () => {
      const client = fakeDocClient(() => ({ Items: [] }))
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.deleteCredential({ name: 'nope' })).toBe(false)
    })

    it('treats a missing Items array as empty when listing credentials', async () => {
      const client = fakeDocClient(() => ({}))
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.listCredentials()).toEqual([])
    })

    it('returns false when neither id nor name is given', async () => {
      const client = fakeDocClient(() => {
        throw new Error('should not call send')
      })
      const store = createDynamoStore({ client, tableName: 'T', now: () => FIXED_NOW })
      expect(await store.deleteCredential({})).toBe(false)
    })
  })

  describe('resolveDynamoConfig defaults', () => {
    const originalTable = process.env.ATEL_TABLE
    const originalTtl = process.env.ATEL_TTL_DAYS

    beforeEach(() => {
      delete process.env.ATEL_TABLE
      delete process.env.ATEL_TTL_DAYS
    })

    afterEach(() => {
      if (originalTable === undefined) delete process.env.ATEL_TABLE
      else process.env.ATEL_TABLE = originalTable
      if (originalTtl === undefined) delete process.env.ATEL_TTL_DAYS
      else process.env.ATEL_TTL_DAYS = originalTtl
    })

    it('builds a real client and default config when no options are given', () => {
      expect(() => createDynamoStore()).not.toThrow()
    })

    it('uses a real clock when now is not provided', async () => {
      const client = fakeDocClient(() => ({}))
      const store = createDynamoStore({ client })
      const before = Date.now()
      const entry = await store.appendEntry({ credId: 'c', sessionId: 's', agent: 'a', data: {} })
      expect(new Date(entry.createdAt).getTime()).toBeGreaterThanOrEqual(before)
    })

    it('reads ATEL_TABLE and ATEL_TTL_DAYS from the environment', async () => {
      process.env.ATEL_TABLE = 'FromEnv'
      process.env.ATEL_TTL_DAYS = '45'
      let putInput: Record<string, unknown> | undefined
      const client = fakeDocClient((command) => {
        putInput = command.input
        return {}
      })
      const store = createDynamoStore({ client, now: () => FIXED_NOW })
      const entry = await store.appendEntry({ credId: 'c', sessionId: 's', agent: 'a', data: {} })
      expect(putInput?.TableName).toBe('FromEnv')
      expect(entry.ttl).toBe(Math.floor(FIXED_NOW.getTime() / 1000) + 45 * 86400)
    })
  })
})
