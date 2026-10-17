import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isValidSessionId, sanitizeSessionId } from './valid-id.mjs'

/** Harnesses that do not expose their session id to every child process, so it is persisted. */
export type PersistedHarness = 'codex' | 'cursor' | 'grok'

/** Persisted-file locations, relative to a worktree root. Each holds one id and a newline. */
export const SESSION_PERSIST_RELATIVE = {
  codex: '.local/codex-session-id',
  cursor: '.local/cursor-session-id',
  grok: '.local/grok-session-id',
} as const

/** The nearest ancestor of `cwd` (inclusive) containing `.git`, or `cwd` itself if none does. */
export function enclosingWorktreeRoot(cwd: string): string {
  let candidate = resolve(cwd)
  while (!existsSync(join(candidate, '.git'))) {
    const parent = dirname(candidate)
    if (parent === candidate) return resolve(cwd)
    candidate = parent
  }
  return candidate
}

/**
 * The persisted-file path for `harness`. `root` may be any directory inside the worktree: it is
 * normalized through `enclosingWorktreeRoot`, so every read and write in this module agrees on the
 * same file regardless of which subdirectory a caller runs from. A directory without its own
 * `.git` inside a repository therefore maps to that repository's `.local/`.
 */
export function sessionPersistPath(root: string, harness: PersistedHarness): string {
  return join(enclosingWorktreeRoot(root), SESSION_PERSIST_RELATIVE[harness])
}

/**
 * Reads a persisted id. Missing or malformed files yield `undefined`, unless `strict`, where a
 * malformed file or any read error other than `ENOENT` throws.
 */
export function readPersistedSessionId(
  root: string,
  harness: PersistedHarness,
  options: { strict?: boolean } = {},
): string | undefined {
  try {
    const raw = readFileSync(sessionPersistPath(root, harness), 'utf8').trim()
    if (isValidSessionId(raw)) return raw
    if (options.strict) throw new Error(`invalid persisted ${harness} session id format`)
    return undefined
  } catch (err) {
    if (options.strict && (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return undefined
  }
}

function writePersistFile(root: string, harness: PersistedHarness, sessionId: string): void {
  const path = sessionPersistPath(root, harness)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${sessionId}\n`, { encoding: 'utf8' })
}

function tryWritePersistFile(root: string, harness: PersistedHarness, sessionId: string): void {
  try {
    writePersistFile(root, harness, sessionId)
  } catch {
    // Hooks must not fail closed when the persist file cannot be written.
  }
}

function generatedId(prefix: string, generateId: (() => string) | undefined): string {
  const generated = sanitizeSessionId(generateId?.() ?? `${prefix}${randomUUID()}`)
  return generated === '' ? `${prefix}${randomUUID()}` : generated
}

/** Persists a real (harness-supplied) id; invalid or empty ids and write failures are ignored. */
export function persistRealSessionId(
  root: string,
  harness: PersistedHarness,
  sessionId: string,
): void {
  const id = sanitizeSessionId(sessionId)
  if (id !== '') tryWritePersistFile(root, harness, id)
}

/**
 * Session-start persistence for hook callers: a real payload id wins and is written; otherwise a
 * valid persisted id is reused; otherwise `<harness>-<uuid>` is generated and written. Never
 * throws on write failure.
 */
export function resolveAndPersistSessionStartId(options: {
  root: string
  harness: PersistedHarness
  payloadId: string
  generateId?: (() => string) | undefined
}): { generated: boolean; sessionId: string } {
  const real = sanitizeSessionId(options.payloadId)
  if (real !== '') {
    tryWritePersistFile(options.root, options.harness, real)
    return { generated: false, sessionId: real }
  }
  const existing = readPersistedSessionId(options.root, options.harness)
  if (existing !== undefined) return { generated: false, sessionId: existing }
  const sessionId = generatedId(`${options.harness}-`, options.generateId)
  tryWritePersistFile(options.root, options.harness, sessionId)
  return { generated: true, sessionId }
}

/**
 * Root Codex persistence. Unlike the hook path, an interactive root Codex caller cannot continue
 * without a durable id, so write and read-back failures surface as errors.
 */
export function resolveAndPersistRootCodexSessionId(options: {
  root: string
  payloadId?: string | undefined
  newSession?: boolean | undefined
  generateId?: (() => string) | undefined
}): { generated: boolean; sessionId: string } {
  const real = options.payloadId?.trim() ?? ''
  if (real !== '' && !isValidSessionId(real)) {
    throw new Error('invalid root Codex session id format')
  }
  try {
    const existing =
      real === '' && !options.newSession
        ? readPersistedSessionId(options.root, 'codex', { strict: true })
        : undefined
    const sessionId = real || existing || generatedId('codex-', options.generateId)
    writePersistFile(options.root, 'codex', sessionId)
    if (readPersistedSessionId(options.root, 'codex', { strict: true }) !== sessionId) {
      throw new Error('persisted session id did not match the selected id')
    }
    return { generated: real === '' && existing === undefined, sessionId }
  } catch (err) {
    throw new Error('failed to persist root Codex session id', { cause: err })
  }
}
