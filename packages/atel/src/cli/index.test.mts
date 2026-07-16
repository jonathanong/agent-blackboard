import { describe, expect, it, vi } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runCli } from './index.mjs'

const ENTRY = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: {},
}

describe('runCli', () => {
  it('dispatches "append" and returns exit code 0 on success', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, ENTRY))
    try {
      const ctx = createFakeContext({
        env: { ATEL_URL: fixture.baseUrl, ATEL_TOKEN: 't' },
      })
      const code = await runCli(['append', '{}', '--session-id', 's1'], ctx)
      expect(code).toBe(0)
      expect(ctx.stdoutLines).toEqual([`${JSON.stringify(ENTRY)}\n`])
    } finally {
      await fixture.close()
    }
  })

  it('returns exit code 1 and writes "Error: ..." to stderr for an unknown command', async () => {
    const ctx = createFakeContext({ env: {} })
    const code = await runCli(['bogus'], ctx)
    expect(code).toBe(1)
    expect(ctx.stderrLines).toEqual([
      'Error: Unknown command: bogus. Expected one of: append, get, patch, credentials, mcp.\n',
    ])
  })

  it('returns exit code 1 with the server error message when the request fails', async () => {
    const fixture = await startHttpFixture((_req, res) =>
      sendJson(res, 401, { message: 'bad token' }),
    )
    try {
      const ctx = createFakeContext({
        env: { ATEL_URL: fixture.baseUrl, ATEL_TOKEN: 't' },
      })
      const code = await runCli(['append', '{}', '--session-id', 's1'], ctx)
      expect(code).toBe(1)
      expect(ctx.stderrLines[0]).toContain('bad token')
    } finally {
      await fixture.close()
    }
  })

  it('dispatches "get" and "patch" and "credentials" to their subcommand handlers', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      const telemetryEnv = { ATEL_URL: fixture.baseUrl, ATEL_TOKEN: 't' }
      const adminEnv = {
        ATEL_URL: fixture.baseUrl,
        ATEL_ADMIN_TOKEN: 'atl_admin_root_secret',
      }

      const getCtx = createFakeContext({ env: telemetryEnv })
      expect(await runCli(['get', '--session-id', 's1'], getCtx)).toBe(0)

      const patchCtx = createFakeContext({ env: telemetryEnv })
      expect(await runCli(['patch', 'a', '--archived', 'true'], patchCtx)).toBe(0)

      const credentialsCtx = createFakeContext({ env: adminEnv })
      expect(await runCli(['credentials', 'list'], credentialsCtx)).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('dispatches "mcp" to the injected startMcpServer with the telemetry config', async () => {
    const ctx = createFakeContext({
      env: { ATEL_URL: 'http://h/', ATEL_TOKEN: 't' },
    })
    const startMcpServer = vi.fn().mockResolvedValue(undefined)
    const code = await runCli(['mcp'], { ...ctx, startMcpServer })
    expect(code).toBe(0)
    expect(startMcpServer).toHaveBeenCalledWith({ baseUrl: 'http://h/', token: 't' })
  })

  it('resolves the real startMcpServer (no override) but never invokes it when env is missing', async () => {
    // No `startMcpServer` override here: this exercises the `options.startMcpServer ?? startMcpServer`
    // fallback selecting the real implementation. `telemetryConfigFromEnv` throws before that selected
    // function is actually called (argument evaluation happens after callee resolution, before the
    // call), so this never touches real stdio.
    const ctx = createFakeContext({ env: {} })
    const code = await runCli(['mcp'], ctx)
    expect(code).toBe(1)
    expect(ctx.stderrLines[0]).toContain('ATEL_URL')
  })

  it('falls back to process.env/stdio when no options are given', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const code = await runCli([])
      expect(code).toBe(0)
      expect(stdoutWrite).toHaveBeenCalled()
    } finally {
      stdoutWrite.mockRestore()
    }
  })

  it('prints usage and returns 0 for no command, "help", and "--help"', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const ctx = createFakeContext({ env: {} })
      const code = await runCli(argv, ctx)
      expect(code).toBe(0)
      expect(ctx.stdoutLines.join('')).toContain('atel — telemetry for autonomous agents')
    }
  })
})
