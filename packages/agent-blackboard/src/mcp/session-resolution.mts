import {
  requireSessionAgent,
  requireSessionId,
  requireSessionIdentity,
} from '../session-id/resolve.mjs'
import { requiredString } from './validate.mjs'

/** The MCP server process's own environment and cwd, used when a tool call omits `sessionId`. */
export interface SessionResolutionContext {
  env: Readonly<Record<string, string | undefined>>
  cwd: string
}

/**
 * An explicit `sessionId` wins and is passed through (the server validates it). When omitted and
 * a resolution context is available, the id is resolved from the harness environment or the
 * per-worktree persisted file; otherwise `sessionId` is required.
 */
export function toolSessionId(
  args: Record<string, unknown>,
  resolution: SessionResolutionContext | undefined,
): string {
  if (args.sessionId !== undefined || resolution === undefined)
    return requiredString(args.sessionId, 'sessionId')
  return requireSessionId(resolution)
}

/** `sessionId` and `agent` for `session_create`/`session_ensure`, resolved as a pair. */
export function toolSessionIdentity(
  args: Record<string, unknown>,
  resolution: SessionResolutionContext | undefined,
): { sessionId: string; agent: string } {
  const sessionIdArg =
    args.sessionId === undefined ? undefined : requiredString(args.sessionId, 'sessionId')
  const agentArg = args.agent === undefined ? undefined : requiredString(args.agent, 'agent')
  if (resolution === undefined || (sessionIdArg !== undefined && agentArg !== undefined)) {
    return {
      sessionId: requiredString(sessionIdArg, 'sessionId'),
      agent: requiredString(agentArg, 'agent'),
    }
  }
  const options = { ...resolution, agentArg }
  if (sessionIdArg === undefined) return requireSessionIdentity(options)
  return { sessionId: sessionIdArg, agent: requireSessionAgent({ ...options, sessionIdArg }) }
}
