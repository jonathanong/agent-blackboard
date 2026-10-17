import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDirs, writePersisted } from '../__tests__/temp-worktree.mjs'
import {
  enclosingWorktreeRoot,
  persistRealSessionId,
  readPersistedSessionId,
  resolveAndPersistRootCodexSessionId,
  resolveAndPersistSessionStartId,
  sessionPersistPath,
  SESSION_PERSIST_RELATIVE,
} from './persist.mjs'

const tempDir = useTempDirs()

async function readPersist(root: string, harness: 'codex' | 'cursor' | 'grok'): Promise<string> {
  return readFile(sessionPersistPath(root, harness), 'utf8')
}

describe('persisted session id files', () => {
  it('keeps the .local/<harness>-session-id location and one-id-plus-newline format', async () => {
    expect(SESSION_PERSIST_RELATIVE).toEqual({
      codex: '.local/codex-session-id',
      cursor: '.local/cursor-session-id',
      grok: '.local/grok-session-id',
    })
    const root = await tempDir()
    persistRealSessionId(root, 'cursor', ' cursor-real ')
    expect(await readFile(join(root, '.local/cursor-session-id'), 'utf8')).toBe('cursor-real\n')
  })

  it('finds the nearest enclosing .git, or falls back to cwd', async () => {
    const root = await tempDir({ git: true })
    const nested = join(root, 'a', 'b')
    await mkdir(nested, { recursive: true })
    expect(enclosingWorktreeRoot(nested)).toBe(root)
    expect(enclosingWorktreeRoot(root)).toBe(root)
    expect(enclosingWorktreeRoot('/')).toBe('/')
  })

  it('reads leniently by default and strictly on request', async () => {
    const root = await tempDir()
    expect(readPersistedSessionId(root, 'codex')).toBeUndefined()
    expect(readPersistedSessionId(root, 'codex', { strict: true })).toBeUndefined()
    await writePersisted(root, 'codex', '../malformed\n')
    expect(readPersistedSessionId(root, 'codex')).toBeUndefined()
    expect(() => readPersistedSessionId(root, 'codex', { strict: true })).toThrow(
      'invalid persisted codex session id format',
    )
    const fileRoot = await tempDir()
    await writeFile(join(fileRoot, '.local'), 'not a directory\n', 'utf8')
    expect(readPersistedSessionId(fileRoot, 'codex')).toBeUndefined()
    expect(() => readPersistedSessionId(fileRoot, 'codex', { strict: true })).toThrow(/ENOTDIR/)
  })

  it('ignores empty or invalid real ids and swallows write failures', async () => {
    const root = await tempDir()
    persistRealSessionId(root, 'cursor', '')
    persistRealSessionId(root, 'cursor', '../etc/passwd')
    expect(readPersistedSessionId(root, 'cursor')).toBeUndefined()
    const fileRoot = await tempDir()
    await writeFile(join(fileRoot, '.local'), 'not a directory\n', 'utf8')
    expect(() => persistRealSessionId(fileRoot, 'cursor', 'cursor-real')).not.toThrow()
  })

  it('does not cross-read cursor and grok persist files', async () => {
    const root = await tempDir()
    persistRealSessionId(root, 'cursor', 'cursor-only')
    persistRealSessionId(root, 'grok', 'grok-only')
    expect(readPersistedSessionId(root, 'cursor')).toBe('cursor-only')
    expect(readPersistedSessionId(root, 'grok')).toBe('grok-only')
  })
})

describe('resolveAndPersistSessionStartId', () => {
  it('writes a real payload id and overwrites a generated id', async () => {
    const root = await tempDir()
    expect(
      resolveAndPersistSessionStartId({
        harness: 'cursor',
        root,
        generateId: () => 'cursor-generated',
        payloadId: '',
      }),
    ).toEqual({ generated: true, sessionId: 'cursor-generated' })
    expect(await readPersist(root, 'cursor')).toBe('cursor-generated\n')
    expect(
      resolveAndPersistSessionStartId({
        harness: 'cursor',
        root,
        generateId: () => 'cursor-other',
        payloadId: 'real-id',
      }),
    ).toEqual({ generated: false, sessionId: 'real-id' })
    expect(await readPersist(root, 'cursor')).toBe('real-id\n')
  })

  it('reuses a valid persist file and never overwrites it with a generated id', async () => {
    const root = await tempDir()
    await writePersisted(root, 'cursor', 'cursor-existing\n')
    expect(
      resolveAndPersistSessionStartId({
        harness: 'cursor',
        root,
        generateId: () => 'cursor-new',
        payloadId: '',
      }),
    ).toEqual({ generated: false, sessionId: 'cursor-existing' })
  })

  it('replaces an invalid persist file, and an invalid generated id, with a fresh id', async () => {
    const root = await tempDir()
    await writePersisted(root, 'cursor', '../etc/passwd\n')
    expect(
      resolveAndPersistSessionStartId({
        harness: 'cursor',
        root,
        generateId: () => 'cursor-fixed',
        payloadId: '',
      }),
    ).toEqual({ generated: true, sessionId: 'cursor-fixed' })
    const other = await tempDir()
    const result = resolveAndPersistSessionStartId({
      harness: 'grok',
      root: other,
      generateId: () => '../bad',
      payloadId: '',
    })
    expect(result.sessionId).toMatch(/^grok-[0-9a-f-]+$/)
    const defaulted = resolveAndPersistSessionStartId({
      harness: 'grok',
      root: await tempDir(),
      payloadId: '',
    })
    expect(defaulted).toEqual({ generated: true, sessionId: expect.stringMatching(/^grok-/) })
  })
})

describe('resolveAndPersistRootCodexSessionId', () => {
  it('does not invoke generation when a real Codex thread id is available', async () => {
    const root = await tempDir()
    expect(
      resolveAndPersistRootCodexSessionId({
        root,
        generateId: () => {
          throw new Error('generation must be lazy')
        },
        payloadId: '  real-codex-thread  ',
      }),
    ).toEqual({ generated: false, sessionId: 'real-codex-thread' })
    expect(readPersistedSessionId(root, 'codex')).toBe('real-codex-thread')
  })

  it('does not invoke generation when a persisted Codex id is available', async () => {
    const root = await tempDir()
    persistRealSessionId(root, 'codex', 'codex-existing')
    expect(
      resolveAndPersistRootCodexSessionId({
        root,
        generateId: () => {
          throw new Error('generation must be lazy')
        },
      }),
    ).toEqual({ generated: false, sessionId: 'codex-existing' })
  })

  it('generates codex-<uuid>, falling back when a supplied generator returns an invalid id', async () => {
    const root = await tempDir()
    const first = resolveAndPersistRootCodexSessionId({ root, generateId: () => '../bad' })
    expect(first).toEqual({
      generated: true,
      sessionId: expect.stringMatching(/^codex-[0-9a-f-]+$/),
    })
    expect(readPersistedSessionId(root, 'codex')).toBe(first.sessionId)
  })

  it('fails closed on malformed persistence, invalid ids, and unwritable roots', async () => {
    const root = await tempDir()
    await writePersisted(root, 'codex', '../malformed\n')
    expect(() => resolveAndPersistRootCodexSessionId({ root })).toThrow(
      'failed to persist root Codex session id',
    )
    expect(() => resolveAndPersistRootCodexSessionId({ root, payloadId: '../bad' })).toThrow(
      'invalid root Codex session id format',
    )
    const fileRoot = await tempDir()
    await writeFile(join(fileRoot, '.local'), 'not a directory\n', 'utf8')
    expect(() => resolveAndPersistRootCodexSessionId({ root: fileRoot, newSession: true })).toThrow(
      'failed to persist root Codex session id',
    )
  })
})
