import { validateRootCodexOptions } from '../session-id/root-codex-options.mjs'
import {
  requireSessionAgent,
  requireSessionId,
  requireSessionIdentity,
  type ResolveSessionIdentityOptions,
} from '../session-id/resolve.mjs'
import type { ParsedArgs } from './args.mjs'
import type { CliContext } from './context.mjs'
import { CliError } from './errors.mjs'

/** Flags that never take a value, so `parseArgs` must not let them swallow a positional. */
export const SESSION_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'root-codex',
  'new-root-codex-session',
])

function bareFlag(flags: ParsedArgs['flags'], key: string, command: string): boolean {
  const value = flags[key]
  if (value === undefined) return false
  if (value !== true) throw new CliError(`${command} --${key} does not accept a value.`)
  return true
}

function resolutionOptions(
  command: string,
  flags: ParsedArgs['flags'],
  ctx: CliContext,
  explicit: Pick<ResolveSessionIdentityOptions, 'agentArg' | 'parentSessionId' | 'sessionIdArg'>,
): ResolveSessionIdentityOptions {
  return {
    env: ctx.env,
    cwd: ctx.cwd,
    ...explicit,
    rootCodex: bareFlag(flags, 'root-codex', command),
    newRootCodexSession: bareFlag(flags, 'new-root-codex-session', command),
  }
}

function cliError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    // The resolver throws plain errors; surface them as usage errors like any other bad flag.
    throw new CliError((err as Error).message, { cause: err })
  }
}

/**
 * `--session-id` for `append`/`get`. An explicit id is passed through untouched (the server
 * validates it); without one, the id is resolved from the harness environment or the
 * per-worktree persisted file.
 */
export function cliSessionId(command: string, flags: ParsedArgs['flags'], ctx: CliContext): string {
  if (flags['session-id'] === true) throw new CliError(`${command} --session-id requires <id>.`)
  const sessionIdArg = typeof flags['session-id'] === 'string' ? flags['session-id'] : undefined
  const options = resolutionOptions(command, flags, ctx, { sessionIdArg })
  return cliError(() => {
    validateRootCodexOptions(options)
    return sessionIdArg ?? requireSessionId(options)
  })
}

/**
 * `<session-id>` and `--agent` for `sessions create|ensure`. Explicit values always win and are
 * never re-validated here; whichever is missing is resolved, paired with the same harness.
 */
export function cliSessionIdentity(
  command: string,
  flags: ParsedArgs['flags'],
  ctx: CliContext,
  explicit: Pick<ResolveSessionIdentityOptions, 'agentArg' | 'parentSessionId' | 'sessionIdArg'>,
): { sessionId: string; agent: string } {
  const options = resolutionOptions(command, flags, ctx, explicit)
  return cliError(() => {
    validateRootCodexOptions(options)
    const { sessionIdArg, agentArg } = explicit
    if (sessionIdArg === undefined) return requireSessionIdentity(options)
    return { sessionId: sessionIdArg, agent: agentArg ?? requireSessionAgent(options) }
  })
}
