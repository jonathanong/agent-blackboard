/** Every coding-agent harness this package can recognize from its environment. */
export const HARNESS_IDS = ['claude', 'codex', 'grok', 'cursor'] as const

export type HarnessId = (typeof HARNESS_IDS)[number]

/**
 * The precedence used when picking a single harness session id from the environment, for callers
 * that need one answer (e.g. agent derivation). Ambient resolution in `resolveSessionIdentity`
 * applies its own, finer-grained rules instead.
 */
export const HARNESS_SESSION_PRECEDENCE: readonly HarnessId[] = [
  'codex',
  'claude',
  'cursor',
  'grok',
]

/** Every harness signal present in an environment, without choosing between them. */
export interface HarnessEnvironment {
  readonly claude: { readonly compatMode: boolean; readonly sessionId?: string }
  readonly codex: { readonly sessionId?: string }
  readonly cursor: { readonly agentMarker: boolean; readonly sessionId?: string }
  readonly grok: {
    readonly agentMarker: boolean
    readonly hookEvent: boolean
    readonly sessionId?: string
  }
}

export interface HarnessSessionIdentity {
  readonly harness: HarnessId
  readonly sessionId: string
}

type Env = Readonly<Record<string, string | undefined>>

function session(value: string | undefined): { readonly sessionId?: string } {
  return value ? { sessionId: value } : {}
}

/**
 * Reads the env-marker table: `CLAUDECODE`/`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`,
 * `CURSOR_AGENT`/`CURSOR_SESSION_ID`, and `GROK_AGENT`/`GROK_HOOK_EVENT`/`GROK_SESSION_ID`.
 * Empty values count as absent. Never throws.
 */
export function inspectHarnessEnvironment(env: Env): HarnessEnvironment {
  return {
    claude: {
      compatMode: env.CLAUDECODE === '1',
      ...session(env.CLAUDE_CODE_SESSION_ID),
    },
    codex: session(env.CODEX_THREAD_ID),
    cursor: {
      agentMarker: Boolean(env.CURSOR_AGENT),
      ...session(env.CURSOR_SESSION_ID),
    },
    grok: {
      agentMarker: Boolean(env.GROK_AGENT),
      hookEvent: Boolean(env.GROK_HOOK_EVENT),
      ...session(env.GROK_SESSION_ID),
    },
  }
}

/** The first harness in `precedence` with a session id, or `undefined` when none has one. */
export function selectHarnessSession(
  environment: HarnessEnvironment,
  precedence: readonly HarnessId[],
): HarnessSessionIdentity | undefined {
  for (const harness of precedence) {
    const sessionId = environment[harness].sessionId
    if (sessionId) return { harness, sessionId }
  }
  return undefined
}

/** Classifies a transcript path by the harness directory layout it lives under. */
export function transcriptPathHarness(transcriptPath: string | undefined): HarnessId | undefined {
  const path = transcriptPath?.replaceAll('\\', '/')
  if (!path) return undefined
  if (path.includes('/.codex/') && path.endsWith('.jsonl')) return 'codex'
  if (path.includes('/.grok/') && path.endsWith('/updates.jsonl')) return 'grok'
  if (path.includes('/.claude/projects/') && path.endsWith('.jsonl')) return 'claude'
  return undefined
}
