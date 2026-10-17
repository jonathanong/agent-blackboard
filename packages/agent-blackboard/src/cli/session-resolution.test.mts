import { describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { useTempDirs } from '../__tests__/temp-worktree.mjs'
import { readPersistedSessionId } from '../session-id/persist.mjs'
import { parseArgs } from './args.mjs'
import { runAppend } from './append.mjs'
import { CliError } from './errors.mjs'
import { runGet } from './get.mjs'
import { runSessions } from './sessions.mjs'
import { cliSessionId, cliSessionIdentity, SESSION_BOOLEAN_FLAGS } from './session-resolution.mjs'

const tempDir = useTempDirs()
const flagsOf = (argv: string[]) => parseArgs(argv, SESSION_BOOLEAN_FLAGS).flags

describe('cliSessionId', () => {
  it('passes an explicit --session-id through untouched, even with server-only characters', () => {
    const ctx = createFakeContext({ env: { CLAUDE_CODE_SESSION_ID: 'ambient' } })
    expect(cliSessionId('append', flagsOf(['--session-id', 'a.b:c']), ctx)).toBe('a.b:c')
  })

  it('resolves from the harness environment when --session-id is omitted', () => {
    const ctx = createFakeContext({ env: { CLAUDE_CODE_SESSION_ID: 'ambient' } })
    expect(cliSessionId('append', {}, ctx)).toBe('ambient')
  })

  it('reports missing ids, bare --session-id, and flag conflicts as CliErrors', () => {
    const ctx = createFakeContext({ env: {} })
    expect(() => cliSessionId('get', {}, ctx)).toThrow(CliError)
    expect(() => cliSessionId('get', {}, ctx)).toThrow(/no session id/)
    expect(() => cliSessionId('get', { 'session-id': true }, ctx)).toThrow(
      'get --session-id requires <id>.',
    )
    expect(() => cliSessionId('get', flagsOf(['--session-id', 's', '--root-codex']), ctx)).toThrow(
      '--root-codex cannot be used with --session-id',
    )
    expect(() => cliSessionId('get', { 'root-codex': 'yes' }, ctx)).toThrow(
      'get --root-codex does not accept a value.',
    )
  })

  it('mints a root Codex id once and reuses it', async () => {
    const cwd = await tempDir({ git: true })
    const ctx = createFakeContext({ env: {}, cwd })
    const minted = cliSessionId(
      'append',
      flagsOf(['--root-codex', '--new-root-codex-session']),
      ctx,
    )
    expect(minted).toMatch(/^codex-/)
    expect(readPersistedSessionId(cwd, 'codex')).toBe(minted)
    expect(cliSessionId('append', flagsOf(['--root-codex']), ctx)).toBe(minted)
  })
})

describe('cliSessionIdentity', () => {
  const ctx = createFakeContext({ env: { CODEX_THREAD_ID: 'thread-1' } })

  it('resolves whichever of id and agent is missing', () => {
    expect(cliSessionIdentity('sessions create', {}, ctx, {})).toEqual({
      agent: 'codex',
      sessionId: 'thread-1',
    })
    expect(cliSessionIdentity('sessions create', {}, ctx, { sessionIdArg: 'x.y' })).toEqual({
      agent: 'codex',
      sessionId: 'x.y',
    })
    expect(
      cliSessionIdentity('sessions create', {}, ctx, { sessionIdArg: 'x.y', agentArg: 'custom' }),
    ).toEqual({ agent: 'custom', sessionId: 'x.y' })
  })

  it('rejects root Codex with a parent, even when id and agent are explicit', () => {
    expect(() =>
      cliSessionIdentity('sessions ensure', flagsOf(['--root-codex']), ctx, {
        agentArg: 'codex',
        parentSessionId: 'p',
      }),
    ).toThrow('--root-codex cannot be used with --parent-session-id')
  })
})

describe('commands without explicit ids', () => {
  it('append, get, and sessions ensure resolve the ambient Claude session', async () => {
    const entry = { sessionId: 'ambient', createdAt: 'now', data: { a: 1 } }
    const fixture = await startHttpFixture((req, res) => {
      if (req.method === 'GET') {
        res.end('[]')
        return
      }
      sendJson(res, req.url === '/sessions' ? 200 : 201, entry)
    })
    try {
      const env = {
        AGENT_BLACKBOARD_URL: fixture.baseUrl,
        AGENT_BLACKBOARD_TOKEN: 't',
        CLAUDE_CODE_SESSION_ID: 'ambient',
      }
      await runAppend(['{"a":1}'], createFakeContext({ env }))
      await runGet([], createFakeContext({ env }))
      await runSessions(['ensure', '--version', '1'], createFakeContext({ env }))
      const paths = fixture.requests.map((r) => `${r.method} ${r.url.split('?')[0]}`)
      expect(paths).toContain('POST /sessions/ambient/entries')
      expect(paths).toContain('GET /sessions/ambient/entries')
      const ensure = fixture.requests.find(
        (r) => r.url?.startsWith('/sessions') && r.body.includes('version'),
      )
      expect(JSON.parse(ensure!.body)).toMatchObject({ id: 'ambient', agent: 'claude-code' })
    } finally {
      await fixture.close()
    }
  })

  it('rejects an empty --agent value', async () => {
    const ctx = createFakeContext({
      env: { AGENT_BLACKBOARD_URL: 'http://h', AGENT_BLACKBOARD_TOKEN: 't', CODEX_THREAD_ID: 't' },
    })
    await expect(runSessions(['create', '--agent=', '--version', '1'], ctx)).rejects.toThrow(
      'sessions create --agent requires <name>.',
    )
  })
})
