import { AgentBlackboardError } from './client/errors.mjs'

const UNPRINTABLE_ERROR = '[unprintable error]'
const UNSERIALIZABLE_ERROR_BODY = '[unserializable error body]'

/**
 * Formats any thrown value as a single-line, human-readable message — never
 * a raw stack trace. Shared by the CLI (stderr) and the MCP server (tool
 * error content), since a caller can throw anything in JS, not just `Error`.
 */
export function formatError(err: unknown): string {
  try {
    if (err instanceof AgentBlackboardError) {
      const body = err.body
      const bodyText = body === undefined ? '' : ` ${formatErrorBody(body)}`
      return `${String(err.message)}${bodyText}`
    }
    if (err instanceof Error) return String(err.message)
    return String(err)
  } catch {
    return UNPRINTABLE_ERROR
  }
}

function formatErrorBody(body: unknown): string {
  try {
    return JSON.stringify(body) ?? UNSERIALIZABLE_ERROR_BODY
  } catch {
    return UNSERIALIZABLE_ERROR_BODY
  }
}
