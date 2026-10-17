/** Shared property schemas and annotation sets for `schemas.mts`. */
export const SESSION_ID = {
  type: 'string' as const,
  description: 'Caller-supplied session id.',
}

export const RESOLVABLE_SESSION_ID = {
  type: 'string' as const,
  description:
    'Session id. An explicit value always wins; when omitted, it is resolved from the MCP ' +
    "server's harness environment (CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID, ...) or the " +
    'per-worktree .local/<harness>-session-id file, and the call fails if none resolves.',
}

export const AGENT = {
  type: 'string' as const,
  description:
    'Agent name, for example claude-code. When omitted, derived from the same harness ' +
    'environment that resolves sessionId.',
}

// Keep all four hints explicit so clients do not rely on protocol defaults.
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

export const IDEMPOTENT_ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export const MUTATING = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const
