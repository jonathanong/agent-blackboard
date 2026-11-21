import { lstat, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempDirs } from '../__tests__/temp-worktree.mjs'
import {
  persistRealSessionId,
  resolveAndPersistRootCodexSessionId,
  sessionPersistPath,
} from './persist.mjs'

const tempDir = useTempDirs()

describe('atomic persisted session id writes', () => {
  it('writes with owner-only permissions and leaves no temp files behind', async () => {
    const root = await tempDir({ git: true })
    persistRealSessionId(root, 'cursor', 'cursor-one')
    persistRealSessionId(root, 'cursor', 'cursor-two')
    const path = sessionPersistPath(root, 'cursor')
    expect(await readFile(path, 'utf8')).toBe('cursor-two\n')
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(root, '.local'))).toEqual(['cursor-session-id'])
  })

  it('replaces a symlink at the target instead of writing through it', async () => {
    const root = await tempDir({ git: true })
    const outside = join(await tempDir(), 'victim')
    await writeFile(outside, 'untouched\n', 'utf8')
    await mkdir(join(root, '.local'), { recursive: true })
    const path = sessionPersistPath(root, 'codex')
    await symlink(outside, path)

    resolveAndPersistRootCodexSessionId({ root, payloadId: 'codex-real' })

    expect(await readFile(outside, 'utf8')).toBe('untouched\n')
    expect((await lstat(path)).isSymbolicLink()).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('codex-real\n')
  })

  it('removes the temp file when the rename fails', async () => {
    const root = await tempDir({ git: true })
    const path = sessionPersistPath(root, 'codex')
    await mkdir(join(path, 'occupied'), { recursive: true })

    expect(() => resolveAndPersistRootCodexSessionId({ root, payloadId: 'codex-real' })).toThrow(
      'failed to persist root Codex session id',
    )
    expect(await readdir(join(root, '.local'))).toEqual(['codex-session-id'])
  })
})
