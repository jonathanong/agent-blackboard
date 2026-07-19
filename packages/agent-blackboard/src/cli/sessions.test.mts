import { expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runSessions } from './sessions.mjs'

it('runs every session command and validates subcommands', async () => {
  const session = {
    id: 's',
    parentSessionId: null,
    agent: 'test-agent',
    version: '1.0.0',
    createdAt: 'now',
    archivedAt: null,
    data: {},
  }
  const fixture = await startHttpFixture((req, res) =>
    sendJson(res, 200, req.url === '/sessions' && req.method === 'GET' ? [session] : session),
  )
  try {
    const env = { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
    for (const argv of [
      ['create', 's', '--agent', 'test-agent', '--version', '1.0.0'],
      [
        'create',
        'child',
        '--parent-session-id',
        's',
        '--agent',
        'test-agent',
        '--version',
        '1.0.0',
      ],
      ['list'],
      ['list', '--archived', 'true'],
      ['get', 's'],
      ['patch', 's', '--data', '{"branch":"main"}'],
      ['archive', 's'],
    ]) {
      const ctx = createFakeContext({ env })
      await runSessions(argv, ctx)
      expect(ctx.stdoutLines).toHaveLength(1)
    }
    const ctx = createFakeContext({ env })
    await expect(runSessions(['create'], ctx)).rejects.toThrow()
    await expect(runSessions(['create', 's'], ctx)).rejects.toThrow('--agent')
    await expect(runSessions(['create', 's', '--agent', 'test'], ctx)).rejects.toThrow('--version')
    await expect(runSessions(['list', '--archived', 'all'], ctx)).rejects.toThrow('true or false')
    await expect(runSessions(['patch', 's'], ctx)).rejects.toThrow('--data')
    for (const data of ['bad', '[]', '{}']) {
      await expect(runSessions(['patch', 's', '--data', data], ctx)).rejects.toThrow()
    }
    await expect(runSessions(['get'], ctx)).rejects.toThrow()
    await expect(runSessions([], ctx)).rejects.toThrow('sessions <subcommand>')
    await expect(runSessions(['nope', 's'], ctx)).rejects.toThrow()
  } finally {
    await fixture.close()
  }
})
