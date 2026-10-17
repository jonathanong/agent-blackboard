import { describe, expect, it } from 'vitest'
import {
  HARNESS_IDS,
  HARNESS_SESSION_PRECEDENCE,
  inspectHarnessEnvironment,
  selectHarnessSession,
  transcriptPathHarness,
} from './harness.mjs'
import { isValidSessionId, sanitizeSessionId } from './valid-id.mjs'

describe('harness environment table', () => {
  it('inspects every simultaneous harness signal without choosing one', () => {
    expect(
      inspectHarnessEnvironment({
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION_ID: 'claude-session',
        CODEX_THREAD_ID: 'codex-session',
        CURSOR_AGENT: '1',
        CURSOR_SESSION_ID: 'cursor-session',
        GROK_AGENT: '1',
        GROK_HOOK_EVENT: '1',
        GROK_SESSION_ID: 'grok-session',
      }),
    ).toEqual({
      claude: { compatMode: true, sessionId: 'claude-session' },
      codex: { sessionId: 'codex-session' },
      cursor: { agentMarker: true, sessionId: 'cursor-session' },
      grok: { agentMarker: true, hookEvent: true, sessionId: 'grok-session' },
    })
  })

  it('keeps markers while ignoring empty session values, and never throws on an empty env', () => {
    expect(
      inspectHarnessEnvironment({
        CLAUDE_CODE_SESSION_ID: '',
        CODEX_THREAD_ID: '',
        CURSOR_AGENT: 'present',
        CURSOR_SESSION_ID: '',
        GROK_AGENT: 'present',
        GROK_HOOK_EVENT: 'present',
        GROK_SESSION_ID: '',
      }),
    ).toEqual({
      claude: { compatMode: false },
      codex: {},
      cursor: { agentMarker: true },
      grok: { agentMarker: true, hookEvent: true },
    })
    const empty = inspectHarnessEnvironment({})
    expect(empty).toEqual({
      claude: { compatMode: false },
      codex: {},
      cursor: { agentMarker: false },
      grok: { agentMarker: false, hookEvent: false },
    })
    expect(selectHarnessSession(empty, HARNESS_SESSION_PRECEDENCE)).toBeUndefined()
  })

  it('pins the harness ids and the codex > claude > cursor > grok session precedence', () => {
    expect(HARNESS_IDS).toEqual(['claude', 'codex', 'grok', 'cursor'])
    expect(HARNESS_SESSION_PRECEDENCE).toEqual(['codex', 'claude', 'cursor', 'grok'])
    const all = inspectHarnessEnvironment({
      CLAUDE_CODE_SESSION_ID: 'claude-session',
      CODEX_THREAD_ID: 'codex-session',
      CURSOR_SESSION_ID: 'cursor-session',
      GROK_SESSION_ID: 'grok-session',
    })
    expect(selectHarnessSession(all, HARNESS_SESSION_PRECEDENCE)).toEqual({
      harness: 'codex',
      sessionId: 'codex-session',
    })
    const withoutCodex = inspectHarnessEnvironment({
      CLAUDE_CODE_SESSION_ID: 'claude-session',
      CURSOR_SESSION_ID: 'cursor-session',
      GROK_SESSION_ID: 'grok-session',
    })
    expect(selectHarnessSession(withoutCodex, HARNESS_SESSION_PRECEDENCE)?.harness).toBe('claude')
    const cursorAndGrok = inspectHarnessEnvironment({
      CURSOR_SESSION_ID: 'cursor-session',
      GROK_SESSION_ID: 'grok-session',
    })
    expect(selectHarnessSession(cursorAndGrok, HARNESS_SESSION_PRECEDENCE)?.harness).toBe('cursor')
    const grokOnly = inspectHarnessEnvironment({ GROK_SESSION_ID: 'grok-session' })
    expect(selectHarnessSession(grokOnly, HARNESS_SESSION_PRECEDENCE)?.harness).toBe('grok')
  })

  it('uses only the caller-supplied precedence', () => {
    const environment = inspectHarnessEnvironment({
      CODEX_THREAD_ID: 'codex-session',
      CURSOR_SESSION_ID: 'cursor-session',
      GROK_SESSION_ID: 'grok-session',
    })
    expect(selectHarnessSession(environment, ['grok', 'codex', 'cursor'])).toEqual({
      harness: 'grok',
      sessionId: 'grok-session',
    })
    expect(selectHarnessSession(environment, ['claude'])).toBeUndefined()
  })

  it('classifies transcript paths by harness directory layout', () => {
    expect(transcriptPathHarness(undefined)).toBeUndefined()
    expect(transcriptPathHarness('')).toBeUndefined()
    expect(transcriptPathHarness('/u/.codex/sessions/2026/rollout-1.jsonl')).toBe('codex')
    expect(transcriptPathHarness('C:\\u\\.codex\\sessions\\rollout-1.jsonl')).toBe('codex')
    expect(transcriptPathHarness('/u/.grok/sessions/repo/s/updates.jsonl')).toBe('grok')
    expect(transcriptPathHarness('/u/.grok/sessions/repo/s/other.jsonl')).toBeUndefined()
    expect(transcriptPathHarness('/u/.claude/projects/-repo/s.jsonl')).toBe('claude')
    expect(transcriptPathHarness('/u/transcript.jsonl')).toBeUndefined()
  })
})

describe('isValidSessionId', () => {
  it('accepts alphanumeric, hyphen, and underscore tokens', () => {
    expect(isValidSessionId('abc-123_XYZ')).toBe(true)
  })

  it('rejects path traversal, glob metacharacters, and the empty string', () => {
    expect(isValidSessionId('../../etc/passwd')).toBe(false)
    expect(isValidSessionId('a/b')).toBe(false)
    expect(isValidSessionId('*')).toBe(false)
    expect(isValidSessionId('a.b')).toBe(false)
    expect(isValidSessionId('')).toBe(false)
  })

  it('sanitizes by trimming and blanking anything invalid', () => {
    expect(sanitizeSessionId('  ok-1 ')).toBe('ok-1')
    expect(sanitizeSessionId('../x')).toBe('')
    expect(sanitizeSessionId(42)).toBe('')
  })
})
