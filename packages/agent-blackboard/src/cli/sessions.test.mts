import { expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runSessions } from './sessions.mjs'

it('runs every session command and validates subcommands', async () => {
  const session = { id: 's', parentSessionId: null, createdAt: 'now', archivedAt: null }
  const fixture = await startHttpFixture((req, res) =>
    sendJson(res, 200, req.url === '/sessions' && req.method === 'GET' ? [session] : session),
  )
  try {
    const env = { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
    for (const argv of [
      ['create', 's'],
      ['create', 'child', '--parent-session-id', 's'],
      ['list'],
      ['get', 's'],
      ['archive', 's'],
    ]) {
      const ctx = createFakeContext({ env })
      await runSessions(argv, ctx)
      expect(ctx.stdoutLines).toHaveLength(1)
    }
    const ctx = createFakeContext({ env })
    await expect(runSessions(['create'], ctx)).rejects.toThrow()
    await expect(runSessions(['get'], ctx)).rejects.toThrow()
    await expect(runSessions([], ctx)).rejects.toThrow('sessions <subcommand>')
    await expect(runSessions(['nope', 's'], ctx)).rejects.toThrow()
  } finally {
    await fixture.close()
  }
})
