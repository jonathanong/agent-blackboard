import { describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runPatch } from './patch.mjs'

const ENV = (url: string) => ({ AGENT_BLACKBOARD_URL: url, AGENT_BLACKBOARD_TOKEN: 't' })

describe('runPatch', () => {
  it('patches by session and timestamp', async () => {
    const entry = { sessionId: 's', createdAt: 'now', data: { a: 1 } }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, entry))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runPatch(['--session-id', 's', '--created-at', 'now', '--data', '{"a":1}'], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({ createdAt: 'now', data: { a: 1 } })
    } finally {
      await fixture.close()
    }
  })

  it('requires every selector and object data', async () => {
    const ctx = createFakeContext({ env: ENV('http://h') })
    await expect(runPatch([], ctx)).rejects.toThrow('session-id')
    await expect(runPatch(['--session-id', 's'], ctx)).rejects.toThrow('created-at')
    await expect(runPatch(['--session-id', 's', '--created-at', 'now'], ctx)).rejects.toThrow(
      'data',
    )
    for (const value of ['bad', '[]', 'null']) {
      await expect(
        runPatch(['--session-id', 's', '--created-at', 'now', '--data', value], ctx),
      ).rejects.toThrow()
    }
  })
})
