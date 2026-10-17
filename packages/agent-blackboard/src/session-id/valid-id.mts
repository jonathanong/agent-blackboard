const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Whether a resolved (ambient, persisted, or hook-supplied) session id is a plain token. Resolved
 * ids reach glob patterns and file paths, so this is stricter than the server's own id rule —
 * explicit caller-supplied ids are left to the server to validate.
 */
export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId)
}

/** Trims a value and returns it if it is a valid session id, else `''`. */
export function sanitizeSessionId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return isValidSessionId(trimmed) ? trimmed : ''
}
