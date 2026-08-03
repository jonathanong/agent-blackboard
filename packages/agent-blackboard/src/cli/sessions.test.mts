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
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  const fixture = await startHttpFixture((req, res) => {
    const isSessionsList =
      req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/sessions'
    sendJson(res, 200, isSessionsList ? { sessions: [session], nextCursor: null } : session)
  })
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
      ['ensure', 's', '--agent', 'test-agent', '--version', '1.0.0'],
      [
        'ensure',
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
      ['list', '--inactive-for-hours', '8'],
      ['list', '--limit', '1'],
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
    await expect(
      runSessions(['create', 's', '--agent', 'test', '--version', '1', '--parent-session-id'], ctx),
    ).rejects.toThrow('--parent-session-id')
    await expect(
      runSessions(
        ['create', 's', '--parent-session-id=', '--agent', 'test', '--version', '1'],
        ctx,
      ),
    ).rejects.toThrow('--parent-session-id')
    await expect(runSessions(['ensure'], ctx)).rejects.toThrow()
    await expect(runSessions(['ensure', 's'], ctx)).rejects.toThrow('--agent')
    await expect(runSessions(['ensure', 's', '--agent', 'test'], ctx)).rejects.toThrow('--version')
    await expect(
      runSessions(['ensure', 's', '--agent', 'test', '--version', '1', '--parent-session-id'], ctx),
    ).rejects.toThrow('--parent-session-id')
    await expect(
      runSessions(
        ['ensure', 's', '--parent-session-id=', '--agent', 'test', '--version', '1'],
        ctx,
      ),
    ).rejects.toThrow('--parent-session-id')
    await expect(runSessions(['list', '--archived', 'all'], ctx)).rejects.toThrow('true or false')
    for (const hours of ['0', '-1', 'nope']) {
      await expect(runSessions(['list', '--inactive-for-hours', hours], ctx)).rejects.toThrow(
        'positive number',
      )
    }
    for (const limit of ['0', '-1', '1.5', 'nope']) {
      await expect(runSessions(['list', '--limit', limit], ctx)).rejects.toThrow('positive integer')
    }
    await expect(runSessions(['list', '--limit'], ctx)).rejects.toThrow('--limit requires <n>')
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

it('drains every page of sessions list into a single flat JSON array', async () => {
  const pageOne = {
    id: 'a',
    parentSessionId: null,
    agent: 'test-agent',
    version: '1.0.0',
    createdAt: 'now',
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  const pageTwo = { ...pageOne, id: 'b' }
  let calls = 0
  const fixture = await startHttpFixture((_req, res) => {
    calls += 1
    sendJson(
      res,
      200,
      calls === 1
        ? { sessions: [pageOne], nextCursor: 'cursor-1' }
        : { sessions: [pageTwo], nextCursor: null },
    )
  })
  try {
    const env = { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
    const ctx = createFakeContext({ env })
    await runSessions(['list'], ctx)
    expect(calls).toBe(2)
    expect(ctx.stdoutLines).toHaveLength(1)
    expect(JSON.parse(ctx.stdoutLines[0]!)).toEqual([pageOne, pageTwo])
    expect(fixture.requests[1]!.url).toContain('cursor=cursor-1')
  } finally {
    await fixture.close()
  }
})

it('sessions list --limit fetches a single bounded page without draining further', async () => {
  const pageOne = {
    id: 'a',
    parentSessionId: null,
    agent: 'test-agent',
    version: '1.0.0',
    createdAt: 'now',
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  let calls = 0
  const fixture = await startHttpFixture((_req, res) => {
    calls += 1
    sendJson(res, 200, { sessions: [pageOne], nextCursor: 'cursor-1' })
  })
  try {
    const env = { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
    const ctx = createFakeContext({ env })
    await runSessions(['list', '--limit', '1'], ctx)
    expect(calls).toBe(1)
    expect(ctx.stdoutLines).toHaveLength(1)
    expect(JSON.parse(ctx.stdoutLines[0]!)).toEqual([pageOne])
    expect(fixture.requests[0]!.url).toContain('limit=1')
  } finally {
    await fixture.close()
  }
})

it('sessions ensure resolves a 409 to the existing session or reports mismatched fields', async () => {
  const existing = {
    id: 's',
    parentSessionId: null,
    agent: 'test-agent',
    version: '1.0.0',
    createdAt: 'now',
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  const matchFixture = await startHttpFixture((req, res) => {
    if (req.method === 'POST') return sendJson(res, 409, { error: 'session exists' })
    sendJson(res, 200, existing)
  })
  try {
    const env = { AGENT_BLACKBOARD_URL: matchFixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
    const ctx = createFakeContext({ env })
    await runSessions(['ensure', 's', '--agent', 'test-agent', '--version', '1.0.0'], ctx)
    expect(JSON.parse(ctx.stdoutLines[0]!)).toEqual({ status: 'exists', session: existing })
  } finally {
    await matchFixture.close()
  }

  const mismatchFixture = await startHttpFixture((req, res) => {
    if (req.method === 'POST') return sendJson(res, 409, { error: 'session exists' })
    sendJson(res, 200, { ...existing, version: '2.0.0' })
  })
  try {
    const env = { AGENT_BLACKBOARD_URL: mismatchFixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
    const ctx = createFakeContext({ env })
    await expect(
      runSessions(['ensure', 's', '--agent', 'test-agent', '--version', '1.0.0'], ctx),
    ).rejects.toThrow('different fields')
  } finally {
    await mismatchFixture.close()
  }
})
