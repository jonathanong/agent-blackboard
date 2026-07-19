import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import {
  dynamoArchiveSession,
  dynamoCreateSession,
  dynamoGetSession,
  dynamoListSessions,
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
      expect(seen[0]!.constructor.name).toBe(
        parentSessionId ? 'TransactWriteCommand' : 'PutCommand',
      )
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

  it('lists paginated sessions and tolerates missing Items', async () => {
    let call = 0
    const doc = client(() => {
      call += 1
      return call === 1 ? { Items: [item()], LastEvaluatedKey: { PK: 'x', SK: 'y' } } : {}
    })
    const sessions = []
    for await (const session of dynamoListSessions(doc, 'T', 'c')) sessions.push(session)
    expect(sessions).toHaveLength(1)
    expect(call).toBe(2)
  })

  it('archives sessions, preserving an existing timestamp', async () => {
    const missing = client(() => ({}))
    await expect(dynamoArchiveSession(missing, 'T', now, 'c', 's')).rejects.toMatchObject({
      code: 'session_not_found',
    })
    const archived = client(() => ({ Item: item({ archivedAt: 'old' }) }))
    await expect(dynamoArchiveSession(archived, 'T', now, 'c', 's')).resolves.toMatchObject({
      archivedAt: 'old',
    })
    let call = 0
    const success = client(() =>
      ++call === 1 ? { Item: item() } : { Attributes: item({ archivedAt: 'new' }) },
    )
    await expect(dynamoArchiveSession(success, 'T', now, 'c', 's')).resolves.toMatchObject({
      archivedAt: 'new',
    })
    call = 0
    const absent = client(() => (++call === 1 ? { Item: item() } : {}))
    await expect(dynamoArchiveSession(absent, 'T', now, 'c', 's')).rejects.toThrow(
      'returned no session',
    )
  })
})
