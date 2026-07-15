import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ResolveSessionIdOptions {
  /** Directory to search from. Defaults to `process.cwd()`. */
  cwd?: string
  /** Environment to read fallback vars from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
}

const SESSION_STATE_RELATIVE_PATH = '.agent-journal/session.json'

// Memoizes ONLY the last-resort generated id, so repeated calls within one
// process agree on a session when no other source is available. The file
// and env lookups below are deliberately re-read on every call (never
// cached) so a long-lived process — e.g. the MCP stdio server — picks up a
// state file rewritten by the SessionStart hook (e.g. after `/clear`)
// without needing to restart.
let generatedFallback: string | undefined

function findProjectRoot(startDir: string): string {
  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
}

function readSessionStateFile(cwd: string): string | undefined {
  const root = findProjectRoot(cwd)
  const path = join(root, SESSION_STATE_RELATIVE_PATH)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { sessionId?: unknown }
    return typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0
      ? parsed.sessionId
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves the session id to journal under, in priority order:
 *
 * 1. An explicit id passed by the caller.
 * 2. A hook-written state file at `.agent-journal/session.json`, found by
 *    walking up from `cwd` to the nearest ancestor containing `.git` (the
 *    project root) — falling back to `cwd` itself if no `.git` is found.
 *    A missing or unparsable file is treated as absent, not an error.
 * 3. `CLAUDE_CODE_SESSION_ID`.
 * 4. `CODEX_THREAD_ID`.
 * 5. A generated id (`crypto.randomUUID()`), memoized for the lifetime of
 *    this process so repeated calls with no other source agree.
 *
 * This is what makes a fresh session (e.g. after `/clear`) automatically
 * start a fresh journal stream: a plugin hook rewrites the state file on
 * `SessionStart`, and step 2 above is re-read from disk on every call.
 */
export function resolveSessionId(explicit?: string, options: ResolveSessionIdOptions = {}): string {
  if (explicit) return explicit
  const fromFile = readSessionStateFile(options.cwd ?? process.cwd())
  if (fromFile) return fromFile
  const env = options.env ?? process.env
  if (env.CLAUDE_CODE_SESSION_ID) return env.CLAUDE_CODE_SESSION_ID
  if (env.CODEX_THREAD_ID) return env.CODEX_THREAD_ID
  generatedFallback ??= randomUUID()
  return generatedFallback
}
