import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDirs, writePersisted } from '../__tests__/temp-worktree.mjs'
import { readPersistedSessionId } from './persist.mjs'
import { requireSessionId, resolveSessionId, resolveSessionIdentity } from './resolve.mjs'

const tempDir = useTempDirs()
const worktree = () => tempDir({ git: true })

describe('resolveSessionId persist fallback', () => {
  it('reads the cursor persist file when no session env is set, from any subdirectory', async () => {
    const cwd = await worktree()
    await writePersisted(cwd, 'cursor', 'cursor-file\n')
    const nested = join(cwd, 'nested')
    await mkdir(nested)
    expect(resolveSessionId({ cwd: nested, env: {} })).toBe('cursor-file')
    expect(resolveSessionIdentity({ cwd, env: {} })?.agent).toBe('cursor')
  })

  it('reads the grok persist file only when GROK_AGENT is set', async () => {
    const cwd = await worktree()
    await writePersisted(cwd, 'grok', 'grok-file\n')
    expect(resolveSessionId({ cwd, env: {} })).toBeUndefined()
    expect(resolveSessionId({ cwd, env: { GROK_AGENT: '1' } })).toBe('grok-file')
    expect(resolveSessionId({ cwd, env: { CLAUDECODE: '1', GROK_AGENT: '1' } })).toBe('grok-file')
  })

  it('resolves its own env over leftover persist files', async () => {
    const cwd = await worktree()
    await writePersisted(cwd, 'cursor', 'cursor-file\n')
    await writePersisted(cwd, 'grok', 'grok-file\n')
    expect(requireSessionId({ cwd, env: { CODEX_THREAD_ID: 'codex' } })).toBe('codex')
    expect(resolveSessionId({ cwd, env: { CLAUDE_CODE_SESSION_ID: 'claude' } })).toBe('claude')
  })

  it('rejects root Codex combined with any explicit session id', async () => {
    const cwd = await worktree()
    expect(() => resolveSessionId({ cwd, env: {}, rootCodex: true, sessionIdArg: '' })).toThrow(
      '--root-codex cannot be used with --session-id',
    )
    expect(readPersistedSessionId(cwd, 'codex')).toBeUndefined()
  })

  it('creates and reuses a root-Codex session without a thread id', async () => {
    const cwd = await worktree()
    const first = resolveSessionId({ cwd, env: {}, rootCodex: true })
    expect(first).toMatch(/^codex-[a-zA-Z0-9_-]+$/)
    expect(readPersistedSessionId(cwd, 'codex')).toBe(first)
    expect(resolveSessionId({ cwd, env: {}, rootCodex: true })).toBe(first)
  })

  it('rotates a root Codex session once, then reuses the selected id', async () => {
    const cwd = await worktree()
    await writePersisted(cwd, 'codex', 'codex-stale\n')
    const rotate = { cwd, env: {}, newRootCodexSession: true, rootCodex: true }
    const rotated = resolveSessionId(rotate)
    expect(rotated).toMatch(/^codex-/)
    expect(rotated).not.toBe('codex-stale')
    expect(resolveSessionId({ cwd, env: {}, rootCodex: true })).toBe(rotated)
    await writePersisted(cwd, 'codex', '../malformed\n')
    expect(resolveSessionId(rotate)).toMatch(/^codex-/)
  })

  it('shares root Codex persistence with commands invoked from a worktree subdirectory', async () => {
    const cwd = await worktree()
    const nested = join(cwd, 'nested', 'directory')
    await mkdir(nested, { recursive: true })
    const sessionId = resolveSessionId({ cwd: nested, env: {}, rootCodex: true })
    expect(readPersistedSessionId(cwd, 'codex')).toBe(sessionId)
    expect(readPersistedSessionId(nested, 'codex')).toBeUndefined()
  })

  it('lets a real Codex thread id win, replacing a generated one', async () => {
    const cwd = await worktree()
    expect(resolveSessionId({ cwd, env: {}, rootCodex: true })).toMatch(/^codex-/)
    expect(
      resolveSessionId({
        cwd,
        env: { CODEX_THREAD_ID: 'real-thread' },
        newRootCodexSession: true,
        rootCodex: true,
      }),
    ).toBe('real-thread')
    expect(readPersistedSessionId(cwd, 'codex')).toBe('real-thread')
  })

  it('rejects rotation outside its unambiguous root-Codex authority', async () => {
    const cwd = await worktree()
    expect(() => resolveSessionId({ cwd, env: {}, newRootCodexSession: true })).toThrow(
      '--new-root-codex-session requires --root-codex',
    )
    expect(() =>
      resolveSessionId({
        cwd,
        env: {},
        newRootCodexSession: true,
        parentSessionId: '',
        rootCodex: true,
      }),
    ).toThrow('--new-root-codex-session cannot be used with --parent-session-id')
    expect(() => resolveSessionId({ cwd, env: {}, parentSessionId: '', rootCodex: true })).toThrow(
      '--root-codex cannot be used with --parent-session-id',
    )
  })

  it('treats a blank ambient Codex thread id as missing', async () => {
    const cwd = await worktree()
    const sessionId = resolveSessionId({ cwd, env: { CODEX_THREAD_ID: '   ' }, rootCodex: true })
    expect(sessionId).toMatch(/^codex-[a-zA-Z0-9_-]+$/)
  })

  it('never cross-reads Cursor or Grok state for a root-Codex session', async () => {
    const cwd = await worktree()
    await writePersisted(cwd, 'cursor', 'cursor-file\n')
    await writePersisted(cwd, 'grok', 'grok-file\n')
    const sessionId = resolveSessionId({ cwd, env: {}, rootCodex: true })
    expect(sessionId).toMatch(/^codex-/)
  })

  it('never creates a Codex session from a runtime hint or detached process', async () => {
    const cwd = await worktree()
    expect(resolveSessionId({ cwd, env: {}, runtime: 'codex' })).toBeUndefined()
    expect(resolveSessionId({ cwd, env: {} })).toBeUndefined()
    expect(readPersistedSessionId(cwd, 'codex')).toBeUndefined()
  })

  it('fails closed when a root-Codex session cannot persist, or the thread id is malformed', async () => {
    const cwd = await worktree()
    await writeFile(join(cwd, '.local'), 'not a directory\n', 'utf8')
    expect(() => resolveSessionId({ cwd, env: {}, rootCodex: true })).toThrow(
      'failed to persist root Codex session id',
    )
    const other = await worktree()
    await writePersisted(other, 'codex', 'codex-existing\n')
    expect(() =>
      resolveSessionId({ cwd: other, env: { CODEX_THREAD_ID: '../malformed' }, rootCodex: true }),
    ).toThrow('invalid root Codex session id format')
    expect(readPersistedSessionId(other, 'codex')).toBe('codex-existing')
  })
})
