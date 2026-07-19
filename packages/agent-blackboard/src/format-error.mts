import { AgentBlackboardError } from './client/errors.mjs'

/**
 * Formats any thrown value as a single-line, human-readable message — never
 * a raw stack trace. Shared by the CLI (stderr) and the MCP server (tool
 * error content), since a caller can throw anything in JS, not just `Error`.
 */
export function formatError(err: unknown): string {
  if (err instanceof AgentBlackboardError) {
    const bodyText = err.body === undefined ? '' : ` ${JSON.stringify(err.body)}`
    return `${err.message}${bodyText}`
  }
  if (err instanceof Error) return err.message
  return String(err)
}
