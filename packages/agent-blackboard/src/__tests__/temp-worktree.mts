import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { sessionPersistPath, type PersistedHarness } from '../session-id/persist.mjs'

/**
 * Temp directories for session-id tests, removed after each test. `git: true` marks the directory
 * as a worktree root (a `.git` file, like a linked worktree) so resolution stops walking up there.
 */
export function useTempDirs(): (options?: { git?: boolean }) => Promise<string> {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })
  return async ({ git = false } = {}) => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-blackboard-session-id-'))
    dirs.push(dir)
    if (git) await writeFile(join(dir, '.git'), 'gitdir: /synthetic/worktree\n', 'utf8')
    return dir
  }
}

export async function writePersisted(
  root: string,
  harness: PersistedHarness,
  contents: string,
): Promise<void> {
  await mkdir(join(root, '.local'), { recursive: true })
  await writeFile(sessionPersistPath(root, harness), contents, 'utf8')
}
