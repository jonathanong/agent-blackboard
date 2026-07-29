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
    expect(itemToSession(item())).toMatchObject({
      id: 's',
      lastEntryAt: null,
      archivedAt: null,
    })
    expect(itemToSession(item({ archivedAt: 'later', parentSessionId: 'p' }))).toMatchObject({
      parentSessionId: 'p',
      lastEntryAt: null,
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
      expect(session.lastEntryAt).toBeNull()
      if (parentSessionId) {
        const condition = (
          command.input.TransactItems as {
            ConditionCheck?: { ConditionExpression: string }
          }[]
        )[0]!.ConditionCheck
        expect(condition?.ConditionExpression).toBe('attribute_exists(PK)')
      }
    }
  })

  it('explains duplicate and missing-parent conditional failures', async () => {
    const scenarios = [
      { gets: [item()], code: 'session_exists' },
      { gets: [undefined, undefined], code: 'parent_not_found' },
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

  it('rejects archiving an unknown session', async () => {
    let calls = 0
    const missing = client(() => {
      calls += 1
      return {}
    })
    await expect(dynamoArchiveSession(missing, 'T', now, 'c', 's')).rejects.toMatchObject({
      code: 'session_not_found',
    })
    expect(calls).toBe(1)
  })

  it('is idempotent on an already-archived session, preserving its timestamp and skipping entries', async () => {
    let calls = 0
    const archived = client(() => {
      calls += 1
      return { Item: item({ archivedAt: 'old' }) }
    })
    await expect(dynamoArchiveSession(archived, 'T', now, 'c', 's')).resolves.toMatchObject({
      archivedAt: 'old',
    })
    expect(calls).toBe(1)
  })

  it('archives a session without touching entries or ttl', async () => {
    let update: Record<string, unknown> | undefined
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return { Item: item() }
      if (command.constructor.name === 'UpdateCommand') {
        update = command.input
        return { Attributes: item({ archivedAt: 'new' }) }
      }
      throw new Error(`unexpected ${command.constructor.name}`)
    })
    await expect(dynamoArchiveSession(doc, 'T', now, 'c', 's')).resolves.toMatchObject({
      archivedAt: 'new',
    })
    expect(update).toMatchObject({
      UpdateExpression: 'SET archivedAt = :archivedAt',
      ExpressionAttributeValues: { ':archivedAt': now().toISOString() },
    })
    expect(update).not.toHaveProperty('ExpressionAttributeNames')
  })

  it('throws if the final archive update returns no session', async () => {
    const doc = client((command) => {
      if (command.constructor.name === 'GetCommand') return { Item: item() }
      if (command.constructor.name === 'UpdateCommand') return {}
      throw new Error(`unexpected ${command.constructor.name}`)
    })
    await expect(dynamoArchiveSession(doc, 'T', now, 'c', 's')).rejects.toThrow(
      'returned no session',
    )
  })
})
