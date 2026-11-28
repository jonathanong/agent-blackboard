import { AgentBlackboardError } from '../client/errors.mjs'

const RETRYABLE_APPEND_STATUSES = new Set([401, 408, 429])
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
])

function isTransportCode(code: unknown): boolean {
  return typeof code === 'string' && (NETWORK_ERROR_CODES.has(code) || code.startsWith('UND_ERR_'))
}

function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  if (isTransportCode((error as NodeJS.ErrnoException).code)) return true
  if (error instanceof TypeError && error.message === 'fetch failed') return true
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error && isTransportCode((cause as NodeJS.ErrnoException).code)) {
    return true
  }
  return false
}

/**
 * Returns true when an `entry_append` failure is a transport/network failure or a retryable
 * HTTP status (`401`, `408`, `429`, `5xx`), meaning the entry should be buffered in the outbox.
 * Configuration and serialization errors (such as invalid URLs) return false and throw immediately.
 */
export function isRetryableAppendError(error: unknown): boolean {
  if (error instanceof AgentBlackboardError) {
    return error.status >= 500 || RETRYABLE_APPEND_STATUSES.has(error.status)
  }
  return isTransportError(error)
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
