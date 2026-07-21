import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { dynamoListSessions } from './dynamo-session-list.mjs'
import { encodeSessionCursor } from './session-cursor.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const AGENT = { agent: 'test-agent', version: '1.0.0' }
const item = (overrides: Record<string, unknown> = {}) => ({
  PK: 'SESSIONS#c',
  SK: 'SESSION#s',
  id: 's',
  parentSessionId: null,
  ...AGENT,
  createdAt: '2026-01-01T00:00:00.000Z',
  data: {},
  ...overrides,
})

describe('dynamoListSessions', () => {
  it('encodes nextCursor from LastEvaluatedKey when one is returned', async () => {
    const doc = client(() => ({
      Items: [item()],
      LastEvaluatedKey: {
        PK: 'SESSIONS#c',
        sessionCreatedAt: '2026-01-01T00:00:00.000Z',
        SK: 'SESSION#s',
      },
    }))
    const result = await dynamoListSessions(doc, 'T', 'c')
    expect(result.sessions).toHaveLength(1)
    expect(result.nextCursor).toBe(
      encodeSessionCursor({ createdAt: '2026-01-01T00:00:00.000Z', sessionId: 's' }),
    )
  })

  it('returns a null nextCursor when there is no LastEvaluatedKey', async () => {
    const doc = client(() => ({ Items: [item()] }))
    const result = await dynamoListSessions(doc, 'T', 'c')
    expect(result.nextCursor).toBeNull()
  })

  it('tolerates a page with no Items', async () => {
    const doc = client(() => ({}))
    const result = await dynamoListSessions(doc, 'T', 'c')
    expect(result.sessions).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it('translates a cursor into an ExclusiveStartKey spanning the GSI and base-table keys', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    const cursor = encodeSessionCursor({ createdAt: '2026-01-01T00:00:00.000Z', sessionId: 's' })
    await dynamoListSessions(doc, 'T', 'c', { cursor })
    expect(seen?.ExclusiveStartKey).toEqual({
      PK: 'SESSIONS#c',
      sessionCreatedAt: '2026-01-01T00:00:00.000Z',
      SK: 'SESSION#s',
    })
  })

  it('omits ExclusiveStartKey when no cursor is given', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    await dynamoListSessions(doc, 'T', 'c')
    expect(seen?.ExclusiveStartKey).toBeUndefined()
  })

  it('clamps a below-minimum limit up to 1', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    await dynamoListSessions(doc, 'T', 'c', { limit: 0 })
    expect(seen?.Limit).toBe(1)
  })

  it('clamps an above-maximum limit down to 200', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    await dynamoListSessions(doc, 'T', 'c', { limit: 10_000 })
    expect(seen?.Limit).toBe(200)
  })

  it('defaults the limit to 50 when unspecified', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    await dynamoListSessions(doc, 'T', 'c')
    expect(seen?.Limit).toBe(50)
  })

  it('merges the built filter into the query, alongside the PK key condition', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    await dynamoListSessions(doc, 'T', 'c', { agent: 'agent-a' })
    expect(seen).toMatchObject({
      IndexName: 'SessionsByCreatedAt',
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#agent = :agent',
      ExpressionAttributeNames: { '#agent': 'agent' },
      ExpressionAttributeValues: { ':pk': 'SESSIONS#c', ':agent': 'agent-a' },
    })
  })

  it('leaves FilterExpression and ExpressionAttributeNames undefined when the query has no filters', async () => {
    let seen: Record<string, unknown> | undefined
    const doc = client((command) => {
      seen = command.input
      return {}
    })
    await dynamoListSessions(doc, 'T', 'c')
    expect(seen?.FilterExpression).toBeUndefined()
    expect(seen?.ExpressionAttributeNames).toBeUndefined()
    expect(seen?.ExpressionAttributeValues).toEqual({ ':pk': 'SESSIONS#c' })
  })
})
