import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSessionId } from './session.mjs'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'atel-session-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function writeStateFile(dir: string, content: string): void {
  mkdirSync(join(dir, '.atel'), { recursive: true })
  writeFileSync(join(dir, '.atel', 'session.json'), content)
}

describe('resolveSessionId', () => {
  it('returns the explicit id, even when a state file is present', () => {
    mkdirSync(join(tmpRoot, '.git'))
    writeStateFile(tmpRoot, JSON.stringify({ sessionId: 'file-session' }))
    expect(resolveSessionId('explicit-session', { cwd: tmpRoot })).toBe('explicit-session')
  })

  it('reads the state file at the nearest ancestor containing .git', () => {
    const repo = join(tmpRoot, 'repo')
    const nested = join(repo, 'nested', 'dir')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    writeStateFile(repo, JSON.stringify({ sessionId: 'file-session' }))
    expect(resolveSessionId(undefined, { cwd: nested })).toBe('file-session')
  })

  it('falls back to cwd itself when no ancestor has a .git', () => {
    const lonely = join(tmpRoot, 'lonely')
    mkdirSync(lonely, { recursive: true })
    writeStateFile(lonely, JSON.stringify({ sessionId: 'lonely-session' }))
    expect(resolveSessionId(undefined, { cwd: lonely })).toBe('lonely-session')
  })

  it('ignores a missing state file and falls through to env', () => {
    mkdirSync(join(tmpRoot, '.git'))
    expect(
      resolveSessionId(undefined, {
        cwd: tmpRoot,
        env: { CLAUDE_CODE_SESSION_ID: 'claude-session' },
      }),
    ).toBe('claude-session')
  })

  it('ignores an unparsable state file and falls through to env', () => {
    mkdirSync(join(tmpRoot, '.git'))
    writeStateFile(tmpRoot, 'not json')
    expect(
      resolveSessionId(undefined, {
        cwd: tmpRoot,
        env: { CLAUDE_CODE_SESSION_ID: 'claude-session' },
      }),
    ).toBe('claude-session')
  })

  it('ignores a state file missing a usable sessionId and falls through to env', () => {
    mkdirSync(join(tmpRoot, '.git'))
    writeStateFile(tmpRoot, JSON.stringify({ sessionId: '' }))
    expect(
      resolveSessionId(undefined, {
        cwd: tmpRoot,
        env: { CLAUDE_CODE_SESSION_ID: 'claude-session' },
      }),
    ).toBe('claude-session')
  })

  it('prefers CLAUDE_CODE_SESSION_ID over CODEX_THREAD_ID', () => {
    mkdirSync(join(tmpRoot, '.git'))
    expect(
      resolveSessionId(undefined, {
        cwd: tmpRoot,
        env: { CLAUDE_CODE_SESSION_ID: 'claude-session', CODEX_THREAD_ID: 'codex-thread' },
      }),
    ).toBe('claude-session')
  })

  it('falls back to CODEX_THREAD_ID when CLAUDE_CODE_SESSION_ID is unset', () => {
    mkdirSync(join(tmpRoot, '.git'))
    expect(
      resolveSessionId(undefined, { cwd: tmpRoot, env: { CODEX_THREAD_ID: 'codex-thread' } }),
    ).toBe('codex-thread')
  })

  it('generates and memoizes a fallback id for the life of the process when no other source exists', async () => {
    mkdirSync(join(tmpRoot, '.git'))
    vi.resetModules()
    const fresh = await import('./session.mjs')
    const first = fresh.resolveSessionId(undefined, { cwd: tmpRoot, env: {} })
    const second = fresh.resolveSessionId(undefined, { cwd: tmpRoot, env: {} })
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
