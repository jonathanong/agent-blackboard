import { AgentBlackboardError } from '../client/errors.mjs'

const RETRYABLE_APPEND_STATUSES = new Set([401, 408, 429])

/**
 * Returns true when an `entry_append` failure is transient or caused by an unreachable server
 * or expired credential, meaning the entry should be buffered in the local outbox for later flush.
 */
export function isRetryableAppendError(error: unknown): boolean {
  if (!(error instanceof AgentBlackboardError)) return true
  return error.status >= 500 || RETRYABLE_APPEND_STATUSES.has(error.status)
}

/** Returns true when the server permanently rejected the entry (non-retryable 4xx). */
export function isPermanentRejection(error: unknown): error is AgentBlackboardError {
  return (
    error instanceof AgentBlackboardError &&
    error.status >= 400 &&
    error.status < 500 &&
    !RETRYABLE_APPEND_STATUSES.has(error.status)
  )
}
