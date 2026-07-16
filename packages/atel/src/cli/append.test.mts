import { describe, expect, it } from 'vitest'
import { createFakeContext, fakeStdin } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runAppend } from './append.mjs'
import { CliError } from './errors.mjs'

const ENTRY = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: { note: 'hi' },
}

describe('runAppend', () => {
  it('posts JSON given as a positional argument, using --session-id and default agent', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const ctx = createFakeContext({
        env: { ATEL_URL: fixture.baseUrl, ATEL_TOKEN: 't' },
      })
      await runAppend(['{"note":"hi"}', '--session-id', 's1'], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({
        sessionId: 's1',
        agent: 'claude-code',
        data: { note: 'hi' },
      })
      expect(ctx.stdoutLines).toEqual([`${JSON.stringify(ENTRY)}\n`])
    } finally {
      await fixture.close()
    }
  })

  it('reads JSON from stdin when no positional argument is given', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const ctx = createFakeContext({
        env: { ATEL_URL: fixture.baseUrl, ATEL_TOKEN: 't' },
        stdin: fakeStdin(['{"note":', Buffer.from('"hi"}')]),
      })
      await runAppend(['--session-id', 's1'], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({
        sessionId: 's1',
        agent: 'claude-code',
        data: { note: 'hi' },
      })
    } finally {
      await fixture.close()
    }
  })

  it('honors a custom --agent flag', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const ctx = createFakeContext({
        env: { ATEL_URL: fixture.baseUrl, ATEL_TOKEN: 't' },
      })
      await runAppend(['{}', '--session-id', 's1', '--agent', 'codex'], ctx)
      expect(JSON.parse(fixture.requests[0]!.body)).toMatchObject({ agent: 'codex' })
    } finally {
      await fixture.close()
    }
  })

  it('throws CliError for invalid JSON', async () => {
    const ctx = createFakeContext({
      env: { ATEL_URL: 'http://h/', ATEL_TOKEN: 't' },
    })
    await expect(runAppend(['not json'], ctx)).rejects.toThrow(CliError)
  })

  it('throws CliError when the JSON is not an object', async () => {
    const ctx = createFakeContext({
      env: { ATEL_URL: 'http://h/', ATEL_TOKEN: 't' },
    })
    await expect(runAppend(['[1,2,3]'], ctx)).rejects.toThrow(CliError)
    await expect(runAppend(['null'], ctx)).rejects.toThrow(CliError)
    await expect(runAppend(['42'], ctx)).rejects.toThrow(CliError)
  })
})
