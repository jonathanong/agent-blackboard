import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDirs } from '../__tests__/temp-worktree.mjs'
import type { HarnessEnvironment } from './harness.mjs'
import {
  requireSessionAgent,
  requireSessionId,
  requireSessionIdentity,
  resolveSessionId,
  resolveSessionIdentity,
  type ResolveSessionIdentityOptions,
} from './resolve.mjs'

const tempDir = useTempDirs()
const cwd = '/nonexistent-agent-blackboard-resolve'

function identity(env: ResolveSessionIdentityOptions['env'], extra = {}) {
  return resolveSessionIdentity({ env, cwd, ...extra })
}

function agent(env: ResolveSessionIdentityOptions['env'], extra = {}) {
  return identity(env, extra)?.agent
}

describe('resolveSessionIdentity', () => {
  it('keeps each selected session paired with its matching agent', () => {
    expect(identity({ CLAUDE_CODE_SESSION_ID: 'claude', CODEX_THREAD_ID: 'codex' })).toEqual({
      agent: 'claude-code',
      harness: 'claude',
      sessionId: 'claude',
    })
    expect(
      identity({ CLAUDE_CODE_SESSION_ID: 'claude', GROK_SESSION_ID: 'grok', GROK_HOOK_EVENT: '1' }),
    ).toMatchObject({ agent: 'claude-code', sessionId: 'claude' })
    expect(
      identity({ CLAUDECODE: '1', CODEX_THREAD_ID: 'codex', GROK_SESSION_ID: 'grok' }),
    ).toMatchObject({ agent: 'codex', sessionId: 'codex' })
    expect(identity({ CLAUDECODE: '1', GROK_SESSION_ID: 'grok' })).toMatchObject({
      agent: 'grok',
      sessionId: 'grok',
    })
    expect(identity({ CURSOR_SESSION_ID: 'cursor', GROK_SESSION_ID: 'grok' })).toMatchObject({
      agent: 'grok',
      sessionId: 'grok',
    })
    expect(identity({ CODEX_THREAD_ID: 'codex', GROK_SESSION_ID: 'grok' })).toMatchObject({
      agent: 'codex',
      sessionId: 'codex',
    })
  })

  it('returns nothing, without throwing, when no harness signal is present', () => {
    expect(identity({})).toBeUndefined()
    expect(resolveSessionId({ env: {}, cwd })).toBeUndefined()
    expect(() => requireSessionAgent({ env: {}, cwd })).toThrow(/no agent identity/)
  })

  it('fails closed for ambiguous Claude-compat signals and invalid selected ids', () => {
    expect(identity({ CLAUDECODE: '1', CODEX_THREAD_ID: 'stale-codex' })).toBeUndefined()
    expect(identity({ CLAUDECODE: '1', CURSOR_SESSION_ID: 'stale-cursor' })).toBeUndefined()
    expect(
      identity({ CLAUDECODE: '1', CODEX_THREAD_ID: 'ambiguous', GROK_AGENT: '1' }),
    ).toBeUndefined()
    expect(identity({ CLAUDECODE: '1', GROK_HOOK_EVENT: '1' })).toEqual({
      agent: 'grok',
      harness: 'grok',
    })
    expect(identity({ CLAUDECODE: '1', GROK_AGENT: '1' })).toEqual({
      agent: 'grok',
      harness: 'grok',
    })
    expect(() =>
      requireSessionIdentity({
        env: { CODEX_THREAD_ID: '../invalid', GROK_SESSION_ID: 'valid-grok' },
        cwd,
      }),
    ).toThrow('invalid session id format: ../invalid')
  })

  it('honors explicit session ids, pairing them with the best-known harness', () => {
    expect(resolveSessionId({ sessionIdArg: 'explicit', cwd, env: {} })).toBe('explicit')
    expect(identity({}, { sessionIdArg: 'explicit' })).toBeUndefined()
    expect(identity({ CODEX_THREAD_ID: 'same' }, { sessionIdArg: 'same' })).toMatchObject({
      harness: 'codex',
    })
    expect(
      identity(
        { CLAUDECODE: '1', GROK_HOOK_EVENT: 'SessionStart' },
        {
          runtime: 'claude',
          sessionIdArg: 'grok-hook-payload',
        },
      ),
    ).toEqual({ agent: 'grok', harness: 'grok', sessionId: 'grok-hook-payload' })
    expect(
      identity(
        { CLAUDE_CODE_SESSION_ID: 'stale-claude' },
        {
          runtime: 'codex',
          sessionIdArg: 'codex-hook-payload',
        },
      ),
    ).toEqual({ agent: 'codex', harness: 'codex', sessionId: 'codex-hook-payload' })
    expect(
      identity(
        { CURSOR_SESSION_ID: 'cursor-session' },
        {
          sessionIdArg: 'payload-id',
          transcriptPath: '/tmp/.codex/sessions/rollout-2026-payload-id.jsonl',
        },
      ),
    ).toEqual({ agent: 'cursor', harness: 'cursor', sessionId: 'payload-id' })
  })

  it('does not pair an explicit root-Codex identity with another or empty agent', () => {
    for (const agentArg of ['claude-code', '']) {
      expect(() => requireSessionIdentity({ agentArg, cwd, env: {}, rootCodex: true })).toThrow(
        '--root-codex requires --agent codex',
      )
    }
  })

  it('accepts an injected harness detection override', () => {
    const inspectEnvironment = (): HarnessEnvironment => ({
      claude: { compatMode: false },
      codex: { sessionId: 'from-override' },
      cursor: { agentMarker: false },
      grok: { agentMarker: false, hookEvent: false },
    })
    expect(
      resolveSessionIdentity({
        env: { CLAUDE_CODE_SESSION_ID: 'ignored' },
        cwd,
        inspectEnvironment,
      }),
    ).toEqual({ agent: 'codex', harness: 'codex', sessionId: 'from-override' })
  })

  it('returns explicit ids as-is, leaving their validation to the server', () => {
    expect(requireSessionId({ env: {}, cwd, sessionIdArg: 'a.b:c' })).toBe('a.b:c')
    expect(
      requireSessionIdentity({ env: {}, cwd, sessionIdArg: 'a.b:c', agentArg: 'custom' }),
    ).toEqual({ agent: 'custom', sessionId: 'a.b:c' })
    expect(() => requireSessionId({ env: {}, cwd, sessionIdArg: '' })).toThrow(/no session id/)
    expect(() => requireSessionId({ env: { CODEX_THREAD_ID: 'bad.id' }, cwd })).toThrow(
      'invalid session id format: bad.id',
    )
  })

  it('pairs explicit agents and ids without consulting the environment', () => {
    expect(
      requireSessionIdentity({ env: {}, cwd, sessionIdArg: 'explicit', agentArg: 'custom' }),
    ).toEqual({ agent: 'custom', sessionId: 'explicit' })
    expect(requireSessionAgent({ env: {}, cwd, agentArg: 'custom' })).toBe('custom')
    expect(() => requireSessionIdentity({ env: {}, cwd, sessionIdArg: 'explicit' })).toThrow(
      /no agent identity/,
    )
    expect(() => requireSessionIdentity({ env: {}, cwd })).toThrow(/no session id/)
  })
})

describe('agent derivation hints', () => {
  it('projects the same ambient precedence into agents', () => {
    expect(agent({ CODEX_THREAD_ID: 'thread' })).toBe('codex')
    expect(agent({ CURSOR_SESSION_ID: 'sess' })).toBe('cursor')
    expect(agent({ GROK_SESSION_ID: 'sess' })).toBe('grok')
    expect(agent({ CODEX_THREAD_ID: 'stale' }, { runtime: 'grok' })).toBe('grok')
    expect(agent({ CURSOR_AGENT: '1' })).toBe('cursor')
  })

  it('selects a runtime hint even without a session id', () => {
    expect(agent({}, { runtime: 'codex' })).toBe('codex')
    expect(agent({}, { runtime: 'claude' })).toBe('claude-code')
    expect(agent({}, { runtime: 'cursor' })).toBe('cursor')
  })

  it('keeps Grok hook env ahead of a Claude-compat runtime hint', () => {
    expect(agent({ GROK_SESSION_ID: 'g' }, { runtime: 'claude' })).toBe('grok')
    expect(agent({ GROK_HOOK_EVENT: 'SessionStart' }, { runtime: 'claude' })).toBe('grok')
  })

  it('does not let a leaked GROK_AGENT override an explicit Codex runtime', () => {
    expect(agent({ GROK_AGENT: 'grok-build' }, { runtime: 'codex' })).toBe('codex')
    expect(agent({ GROK_AGENT: 'grok-build' })).toBe('grok')
  })

  it('classifies a transcript path only when env has no identity', async () => {
    const dir = await tempDir()
    const hint = (transcriptPath: string) => agent({}, { transcriptPath })
    expect(hint(join(dir, '.codex', 'sessions', 'rollout-2026-08-23-thread-1.jsonl'))).toBe('codex')
    expect(hint('/Users/someone/.grok/sessions/repo/sess-1/updates.jsonl')).toBe('grok')
    expect(hint('/Users/someone/.claude/projects/-repo/sess-1.jsonl')).toBe('claude-code')
    expect(hint(join(dir, 'updates.jsonl'))).toBeUndefined()
    expect(hint(join(dir, 'transcript.jsonl'))).toBeUndefined()
  })
})
