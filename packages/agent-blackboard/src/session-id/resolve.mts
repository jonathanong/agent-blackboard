import {
  inspectHarnessEnvironment,
  selectHarnessSession,
  transcriptPathHarness,
  type HarnessEnvironment,
  type HarnessId,
} from './harness.mjs'
import {
  enclosingWorktreeRoot,
  readPersistedSessionId,
  resolveAndPersistRootCodexSessionId,
} from './persist.mjs'
import { validateRootCodexOptions } from './root-codex-options.mjs'
import { isValidSessionId } from './valid-id.mjs'

/** The `agent` value `sessions create|ensure` records for each harness. */
export type SessionAgent = 'claude-code' | 'codex' | 'cursor' | 'grok'

export interface SessionIdentity {
  readonly agent: SessionAgent
  readonly harness: HarnessId
  readonly sessionId?: string
}

export interface ResolveSessionIdentityOptions {
  /** The environment to read harness markers from. Never defaulted to `process.env`. */
  env: Readonly<Record<string, string | undefined>>
  /** Where persisted ids are looked up (walking up to the nearest `.git`). */
  cwd: string
  /** Overrides harness detection; defaults to the built-in `inspectHarnessEnvironment`. */
  inspectEnvironment?: (env: ResolveSessionIdentityOptions['env']) => HarnessEnvironment
  /** A runtime the caller already knows it is running under (e.g. from hook argv). */
  runtime?: HarnessId | undefined
  /** A transcript path hint, classified by harness directory layout. */
  transcriptPath?: string | undefined
  agentArg?: string | undefined
  sessionIdArg?: string | undefined
  parentSessionId?: string | undefined
  rootCodex?: boolean | undefined
  newRootCodexSession?: boolean | undefined
}

const MISSING_SESSION_ID_ERROR =
  'no session id (set CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID, CURSOR_SESSION_ID, GROK_SESSION_ID, or pass --session-id; interactive root Codex without CODEX_THREAD_ID: use --root-codex --new-root-codex-session once, then --root-codex)'
const MISSING_AGENT_ERROR =
  'no agent identity (set CLAUDE_CODE_SESSION_ID, CURSOR_SESSION_ID, GROK_SESSION_ID, GROK_AGENT, CODEX_THREAD_ID, or pass --agent)'

export function agentForHarness(harness: HarnessId): SessionAgent {
  return harness === 'claude' ? 'claude-code' : harness
}

function fromHarness(harness: HarnessId, sessionId?: string): SessionIdentity {
  return sessionId
    ? { agent: agentForHarness(harness), harness, sessionId }
    : { agent: agentForHarness(harness), harness }
}

function harnessForSessionId(
  environment: HarnessEnvironment,
  sessionId: string,
): HarnessId | undefined {
  for (const harness of ['claude', 'codex', 'grok', 'cursor'] as const) {
    if (environment[harness].sessionId === sessionId) return harness
  }
  return undefined
}

function compatModeIdentity(
  environment: HarnessEnvironment,
  cwd: string,
): SessionIdentity | undefined {
  if (environment.grok.sessionId) {
    return environment.codex.sessionId
      ? fromHarness('codex', environment.codex.sessionId)
      : fromHarness('grok', environment.grok.sessionId)
  }
  if (!environment.grok.agentMarker)
    return environment.grok.hookEvent ? fromHarness('grok') : undefined
  // A leaked Codex or Cursor id alongside a Grok marker is ambiguous: fail closed.
  if (environment.codex.sessionId || environment.cursor.sessionId) return undefined
  const sessionId = readPersistedSessionId(enclosingWorktreeRoot(cwd), 'grok')
  return fromHarness('grok', sessionId)
}

/**
 * Resolves `{ agent, harness, sessionId? }` from an explicit id, then environment markers, then a
 * runtime or transcript hint, then the per-worktree persisted id. Returns `undefined` when nothing
 * identifies a harness. `sessionId` is absent when the harness is known but its id is not.
 */
export function resolveSessionIdentity(
  options: ResolveSessionIdentityOptions,
): SessionIdentity | undefined {
  const { env, cwd } = options
  validateRootCodexOptions(options)
  const environment = (options.inspectEnvironment ?? inspectHarnessEnvironment)(env)
  if (options.sessionIdArg !== undefined) {
    const matched = harnessForSessionId(environment, options.sessionIdArg)
    const ambient = resolveSessionIdentity({
      ...options,
      rootCodex: false,
      sessionIdArg: undefined,
    })
    const harness =
      matched ??
      (environment.grok.hookEvent ? 'grok' : undefined) ??
      options.runtime ??
      ambient?.harness ??
      transcriptPathHarness(options.transcriptPath)
    return harness ? fromHarness(harness, options.sessionIdArg) : undefined
  }
  // Root-aware reads and writes both refresh persistence at the enclosing worktree root. This
  // trust boundary is conventional: a child that falsely passes the root flag inherits the root
  // identity.
  if (options.rootCodex) {
    const resolved = resolveAndPersistRootCodexSessionId({
      root: enclosingWorktreeRoot(cwd),
      newSession: options.newRootCodexSession,
      payloadId: env.CODEX_THREAD_ID,
    })
    return fromHarness('codex', resolved.sessionId)
  }
  if (environment.claude.sessionId) return fromHarness('claude', environment.claude.sessionId)
  if (environment.claude.compatMode) return compatModeIdentity(environment, cwd)
  if ((environment.grok.sessionId || environment.grok.hookEvent) && !environment.codex.sessionId)
    return fromHarness('grok', environment.grok.sessionId)
  if (options.runtime) return fromHarness(options.runtime)
  const direct = selectHarnessSession(environment, ['codex', 'grok', 'cursor'])
  if (direct) return fromHarness(direct.harness, direct.sessionId)
  const persistedHarness = environment.grok.agentMarker ? 'grok' : 'cursor'
  const sessionId = readPersistedSessionId(enclosingWorktreeRoot(cwd), persistedHarness)
  if (sessionId) return fromHarness(persistedHarness, sessionId)
  const transcript = transcriptPathHarness(options.transcriptPath)
  if (transcript) return fromHarness(transcript)
  if (environment.grok.agentMarker) return fromHarness('grok')
  return environment.cursor.agentMarker ? fromHarness('cursor') : undefined
}

/** The explicit id if given, else the resolved one. Does not validate. */
export function resolveSessionId(options: ResolveSessionIdentityOptions): string | undefined {
  const identity = resolveSessionIdentity(options)
  return options.sessionIdArg ?? identity?.sessionId
}

/** Like `resolveSessionId`, but throws when no id resolves or the id is not a plain token. */
export function requireSessionId(options: ResolveSessionIdentityOptions): string {
  return checkedSessionId(resolveSessionId(options))
}

function checkedSessionId(sessionId: string | undefined): string {
  if (!sessionId) throw new Error(MISSING_SESSION_ID_ERROR)
  if (!isValidSessionId(sessionId)) throw new Error(`invalid session id format: ${sessionId}`)
  return sessionId
}

/** The explicit `agentArg` if given, else the resolved agent; throws when neither exists. */
export function requireSessionAgent(options: ResolveSessionIdentityOptions): string {
  const agent = options.agentArg ?? resolveSessionIdentity(options)?.agent
  if (!agent) throw new Error(MISSING_AGENT_ERROR)
  return agent
}

/** Both the session id and the agent, resolved together so they always pair. */
export function requireSessionIdentity(options: ResolveSessionIdentityOptions): {
  agent: string
  sessionId: string
} {
  const identity = resolveSessionIdentity(options)
  const sessionId = checkedSessionId(options.sessionIdArg ?? identity?.sessionId)
  const agent = options.agentArg ?? identity?.agent
  if (!agent) throw new Error(MISSING_AGENT_ERROR)
  return { agent, sessionId }
}
