import { describe, expect, it, vi } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runCli } from './index.mjs'

describe('runCli', () => {
  it('dispatches session and entry commands', async () => {
    const value = { sessionId: 's', createdAt: 'now', data: {} }
    const fixture = await startHttpFixture((req, res) => {
      if (req.method !== 'GET') return sendJson(res, 200, value)
      const isSessionsList = new URL(req.url, 'http://localhost').pathname === '/sessions'
      sendJson(res, 200, isSessionsList ? { sessions: [], nextCursor: null } : [])
    })
    try {
      const env = { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' }
      for (const argv of [
        ['sessions', 'list'],
        ['append', '--session-id', 's', '{}'],
        ['get', '--session-id', 's'],
      ]) {
        expect(await runCli(argv, createFakeContext({ env }))).toBe(0)
      }
    } finally {
      await fixture.close()
    }
  })

  it('dispatches credentials and an injected MCP server', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      const admin = createFakeContext({
        env: { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_ADMIN_TOKEN: 'admin' },
      })
      expect(await runCli(['credentials', 'list'], admin)).toBe(0)
    } finally {
      await fixture.close()
    }
    const startMcpServer = vi.fn().mockResolvedValue(undefined)
    const ctx = createFakeContext({
      env: { AGENT_BLACKBOARD_URL: 'http://h', AGENT_BLACKBOARD_TOKEN: 't' },
    })
    expect(await runCli(['mcp'], { ...ctx, startMcpServer })).toBe(0)
    expect(startMcpServer).toHaveBeenCalledWith({ baseUrl: 'http://h', token: 't' })
  })

  it('dispatches snapshot export', async () => {
    const fixture = await startHttpFixture((_req, res) =>
      sendNdjson(res, [
        {
          type: 'session',
          session: {
            id: 's',
            parentSessionId: null,
            agent: 'a',
            version: '1',
            createdAt: 'now',
            lastEntryAt: null,
            archivedAt: null,
            data: {},
          },
        },
        {
          type: 'manifest',
          manifest: {
            schemaVersion: 1,
            status: 'complete',
            createdAt: 'now',
            completedAt: 'now',
            selection: { archived: false },
            counts: { sessions: 1, entries: 0, records: 2 },
            ordering: {
              sessions: 'createdAt,id ascending',
              entries: 'createdAt ascending within session',
            },
            consistency: 'best-effort',
          },
        },
      ]),
    )
    try {
      const ctx = createFakeContext({
        env: { AGENT_BLACKBOARD_URL: fixture.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' },
      })
      expect(await runCli(['snapshot', 'export'], ctx)).toBe(0)
      const result = JSON.parse(ctx.stdoutLines[0]!) as { path: string }
      expect(result.path).toContain('agent-blackboard-snapshot-')
      const { rm } = await import('node:fs/promises')
      await rm(result.path, { force: true })
    } finally {
      await fixture.close()
    }
  })

  it('prints help and formats command/server errors', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const ctx = createFakeContext({ env: {} })
      expect(await runCli(argv, ctx)).toBe(0)
      expect(ctx.stdoutLines.join('')).toContain('entry stream')
    }
    const unknown = createFakeContext({ env: {} })
    expect(await runCli(['bogus'], unknown)).toBe(1)
    expect(unknown.stderrLines[0]).toContain('sessions, append')
    const missingEnv = createFakeContext({ env: {} })
    expect(await runCli(['mcp'], missingEnv)).toBe(1)
    expect(missingEnv.stderrLines[0]).toContain('AGENT_BLACKBOARD_URL')
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(await runCli([])).toBe(0)
    } finally {
      stdoutWrite.mockRestore()
    }
  })
})
