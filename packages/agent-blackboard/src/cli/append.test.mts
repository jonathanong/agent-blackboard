import { describe, expect, it } from 'vitest'
import { createFakeContext, fakeStdin } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runAppend } from './append.mjs'
import { CliError } from './errors.mjs'

const ENV = (url: string) => ({ AGENT_BLACKBOARD_URL: url, AGENT_BLACKBOARD_TOKEN: 't' })

describe('runAppend', () => {
  it('requires an explicit session and accepts positional or stdin JSON', async () => {
    const entry = { sessionId: 's', createdAt: 'now', data: { a: 1 } }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 201, entry))
    try {
      const first = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runAppend(['--session-id', 's', '{"a":1}'], first)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({ data: { a: 1 } })
      expect(first.stdoutLines).toEqual([`${JSON.stringify(entry)}\n`])
      const second = createFakeContext({
        env: ENV(fixture.baseUrl),
        stdin: fakeStdin(['{"a":', Buffer.from('1'), '}']),
      })
      await runAppend(['--session-id', 's'], second)
    } finally {
      await fixture.close()
    }
  })

  it('rejects missing sessions and invalid data', async () => {
    const ctx = createFakeContext({ env: ENV('http://h') })
    await expect(runAppend(['{}'], ctx)).rejects.toThrow('session-id')
    await expect(runAppend(['--session-id', 's', 'bad'], ctx)).rejects.toThrow(CliError)
    for (const value of ['[]', 'null', '1']) {
      await expect(runAppend(['--session-id', 's', value], ctx)).rejects.toThrow(CliError)
    }
  })
})
