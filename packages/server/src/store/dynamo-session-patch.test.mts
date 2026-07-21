import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { dynamoPatchSession } from './dynamo-session-patch.mjs'

interface Command {
  constructor: { name: string }
  input: Record<string, unknown>
}

function client(handler: (command: Command) => unknown): DynamoDBDocumentClient {
  return { send: vi.fn((command) => Promise.resolve(handler(command as Command))) } as never
}

const SESSION = {
  id: 's',
  parentSessionId: null,
  agent: 'test-agent',
  version: '1.0.0',
  createdAt: 'now',
  data: { old: true },
}

function conditional(): Error {
  return Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' })
}

describe('dynamoPatchSession', () => {
  it('updates individual map fields and returns the session', async () => {
    let input: Record<string, unknown> | undefined
    const result = await dynamoPatchSession(
      client((command) => {
        input = command.input
        return { Attributes: { ...SESSION, data: { old: true, branch: 'main' } } }
      }),
      'T',
      'c',
      { sessionId: 's', data: { branch: 'main' } },
    )
    expect(result.data).toEqual({ old: true, branch: 'main' })
    expect(input).toMatchObject({
      UpdateExpression: 'SET #data.#key0 = :value0',
      ExpressionAttributeNames: { '#data': 'data', '#key0': 'branch' },
      ExpressionAttributeValues: { ':value0': 'main' },
    })
  })

  it('rejects an empty data patch before sending any command', async () => {
    const send = vi.fn(() => {
      throw new Error('should never be called')
    })
    const doc = { send } as unknown as DynamoDBDocumentClient
    await expect(dynamoPatchSession(doc, 'T', 'c', { sessionId: 's', data: {} })).rejects.toThrow(
      'patchSession requires at least one key in data',
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('surfaces ordinary and malformed successful responses', async () => {
    await expect(
      dynamoPatchSession(
        client(() => ({})),
        'T',
        'c',
        { sessionId: 's', data: { a: 1 } },
      ),
    ).rejects.toThrow('returned no session')
    await expect(
      dynamoPatchSession(
        client(() => {
          throw 'boom'
        }),
        'T',
        'c',
        { sessionId: 's', data: { a: 1 } },
      ),
    ).rejects.toBe('boom')
  })

  it('distinguishes missing and archived conditional failures', async () => {
    for (const [item, code] of [
      [undefined, 'session_not_found'],
      [{ ...SESSION, archivedAt: 'later' }, 'session_archived'],
    ] as const) {
      await expect(
        dynamoPatchSession(
          client((command) => {
            if (command.constructor.name === 'UpdateCommand') throw conditional()
            return item ? { Item: item } : {}
          }),
          'T',
          'c',
          { sessionId: 's', data: { a: 1 } },
        ),
      ).rejects.toMatchObject({ code })
    }
  })
})
