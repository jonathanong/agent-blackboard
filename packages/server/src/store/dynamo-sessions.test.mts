import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import {
  dynamoArchiveSession,
  dynamoCreateSession,
  dynamoGetSession,
  itemToSession,
} from './dynamo-sessions.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const now = () => new Date('2026-01-01T00:00:00.000Z')
const AGENT = { agent: 'test-agent', version: '1.0.0' }
const item = (overrides: Record<string, unknown> = {}) => ({
  PK: 'SESSIONS#c',
  SK: 'SESSION#s',
  id: 's',
  parentSessionId: null,
  ...AGENT,
  createdAt: now().toISOString(),
  data: {},
  ...overrides,
})

function conditional(name = 'ConditionalCheckFailedException'): Error {
  return Object.assign(new Error(name), { name })
}

describe('DynamoDB sessions', () => {
  it('maps, gets, and misses sessions', async () => {
    expect(itemToSession(item())).toMatchObject({ id: 's', archivedAt: null })
    expect(itemToSession(item({ archivedAt: 'later', parentSessionId: 'p' }))).toMatchObject({
      parentSessionId: 'p',
      archivedAt: 'later',
    })
    expect(
      await dynamoGetSession(
        client(() => ({ Item: item() })),
        'T',
        'c',
        's',
      ),
    ).toMatchObject({
      id: 's',
    })
    expect(
      await dynamoGetSession(
        client(() => ({})),
        'T',
        'c',
        'missing',
      ),
    ).toBeUndefined()
  })

  it('creates roots with a conditional put and children transactionally', async () => {
    for (const parentSessionId of [null, 'parent']) {
      const seen: Command[] = []
      const doc = client((command) => {
        seen.push(command)
        return {}
      })
      const session = await dynamoCreateSession(doc, 'T', now, {
        credId: 'c',
        id: 's',
        parentSessionId,
        ...AGENT,
      })
      expect(session).toMatchObject({ id: 's', parentSessionId })
      const command = seen[0]!
      expect(command.constructor.name).toBe(parentSessionId ? 'TransactWriteCommand' : 'PutCommand')
      const putItem = parentSessionId
        ? (command.input.TransactItems as { Put?: { Item: Record<string, unknown> } }[])[1]!.Put!
            .Item
        : (command.input.Item as Record<string, unknown>)
      expect(putItem.sessionCreatedAt).toBe(session.createdAt)
    }
  })

  it('explains duplicate, missing-parent, and archived-parent conditional failures', async () => {
    const scenarios = [
      { gets: [item()], code: 'session_exists' },
      { gets: [undefined, undefined], code: 'parent_not_found' },
      { gets: [undefined, item({ id: 'p', archivedAt: 'later' })], code: 'parent_archived' },
    ]
    for (const scenario of scenarios) {
      let gets = 0
      const doc = client((command) => {
        if (command.constructor.name !== 'GetCommand')
          throw conditional('TransactionCanceledException')
        const value = scenario.gets[gets++]
        return value ? { Item: value } : {}
      })
      await expect(
        dynamoCreateSession(doc, 'T', now, {
          credId: 'c',
          id: 's',
          parentSessionId: 'p',
          ...AGENT,
        }),
      ).rejects.toMatchObject({ code: scenario.code })
    }
  })

  it('surfaces unexplained conditional and non-conditional failures', async () => {
    const unexplained = client((command) => {
      if (command.constructor.name === 'PutCommand') throw conditional()
      return {}
    })
    await expect(
      dynamoCreateSession(unexplained, 'T', now, {
        credId: 'c',
        id: 's',
        parentSessionId: null,
        ...AGENT,
      }),
    ).rejects.toThrow('session creation transaction failed')
    let gets = 0
    const activeParent = client((command) => {
      if (command.constructor.name !== 'GetCommand')
        throw conditional('TransactionCanceledException')
      return ++gets === 1 ? {} : { Item: item({ id: 'p' }) }
    })
    await expect(
      dynamoCreateSession(activeParent, 'T', now, {
        credId: 'c',
        id: 's',
        parentSessionId: 'p',
        ...AGENT,
      }),
    ).rejects.toThrow('session creation transaction failed')
    const boom = client(() => {
      throw new Error('boom')
    })
    await expect(
      dynamoCreateSession(boom, 'T', now, {
        credId: 'c',
        id: 's',
        parentSessionId: null,
        ...AGENT,
      }),
    ).rejects.toThrow('boom')
  })

  const TTL_DAYS = 30

  it('rejects archiving an unknown session without touching entries', async () => {
    let calls = 0
    const missing = client(() => {
      calls += 1
      return {}
    })
    await expect(dynamoArchiveSession(missing, 'T', TTL_DAYS, now, 'c', 's')).rejects.toMatchObject(
      { code: 'session_not_found' },
    )
    expect(calls).toBe(1)
  })

  it('is idempotent on an already-archived session, preserving its timestamp and skipping entries', async () => {
    let calls = 0
    const archived = client(() => {
      calls += 1
      return { Item: item({ archivedAt: 'old' }) }
    })
    await expect(
      dynamoArchiveSession(archived, 'T', TTL_DAYS, now, 'c', 's'),
    ).resolves.toMatchObject({ archivedAt: 'old' })
    expect(calls).toBe(1)
  })

  it('archives a session with zero entries', async () => {
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return { Item: item() }
      if (command.constructor.name === 'QueryCommand') return {}
      if (command.constructor.name === 'UpdateCommand')
        return { Attributes: item({ archivedAt: 'new' }) }
      throw new Error(`unexpected ${command.constructor.name}`)
    })
    await expect(dynamoArchiveSession(doc, 'T', TTL_DAYS, now, 'c', 's')).resolves.toMatchObject({
      archivedAt: 'new',
    })
  })

  it('fans the same ttl onto every entry before flipping archivedAt on the session', async () => {
    const calls: Command[] = []
    const doc = client((command) => {
      calls.push(command)
      if (command.constructor.name === 'GetCommand') return { Item: item() }
      if (command.constructor.name === 'QueryCommand') {
        return {
          Items: [
            { PK: 'ENTRIES#c#s', SK: 'ENTRY#a' },
            { PK: 'ENTRIES#c#s', SK: 'ENTRY#b' },
          ],
        }
      }
      const key = command.input.Key as { PK: string }
      return key.PK === 'SESSIONS#c' ? { Attributes: item({ archivedAt: 'new' }) } : {}
    })
    const expectedTtl = Math.floor(now().getTime() / 1000) + TTL_DAYS * 86400

    await expect(dynamoArchiveSession(doc, 'T', TTL_DAYS, now, 'c', 's')).resolves.toMatchObject({
      archivedAt: 'new',
    })

    const isEntryUpdate = (c: Command): boolean =>
      c.constructor.name === 'UpdateCommand' && (c.input.Key as { PK: string }).PK === 'ENTRIES#c#s'
    const isSessionUpdate = (c: Command): boolean =>
      c.constructor.name === 'UpdateCommand' && (c.input.Key as { PK: string }).PK === 'SESSIONS#c'

    const entryUpdates = calls.filter(isEntryUpdate)
    expect(entryUpdates).toHaveLength(2)
    for (const update of entryUpdates) {
      expect(update.input).toMatchObject({
        UpdateExpression: 'SET #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ttl': expectedTtl },
      })
    }

    const lastEntryIndex = calls.reduce((last, c, index) => (isEntryUpdate(c) ? index : last), -1)
    const sessionIndex = calls.findIndex(isSessionUpdate)
    expect(sessionIndex).toBeGreaterThan(lastEntryIndex)

    const sessionUpdate = calls[sessionIndex]!
    expect(sessionUpdate.input).toMatchObject({
      UpdateExpression: 'SET archivedAt = :archivedAt, #ttl = :ttl',
      ExpressionAttributeValues: { ':archivedAt': now().toISOString(), ':ttl': expectedTtl },
    })
  })

  it('throws if the final archive update returns no session', async () => {
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return { Item: item() }
      if (command.constructor.name === 'QueryCommand') return {}
      if (command.constructor.name === 'UpdateCommand') return {}
      throw new Error(`unexpected ${command.constructor.name}`)
    })
    await expect(dynamoArchiveSession(doc, 'T', TTL_DAYS, now, 'c', 's')).rejects.toThrow(
      'returned no session',
    )
  })
})
