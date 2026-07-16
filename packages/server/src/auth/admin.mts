import { constantTimeEqual } from './constant-time.mjs'
import { parseBearerToken } from './parse-bearer.mjs'

interface AdminCredentialEntry {
  name: string
  token: string
}

/** Shape of the env passed to `resolveAdminCredential` — a subset of `process.env`. */
export interface AdminEnv {
  /** base64 of a JSON array of `{ name, token }` — the only place admin credentials live. */
  ATEL_ADMIN_CREDENTIALS?: string
}

function parseAdminCredentials(env: AdminEnv): AdminCredentialEntry[] {
  if (!env.ATEL_ADMIN_CREDENTIALS) return []
  try {
    const json = Buffer.from(env.ATEL_ADMIN_CREDENTIALS, 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAdminCredentialEntry)
  } catch {
    return []
  }
}

function isAdminCredentialEntry(value: unknown): value is AdminCredentialEntry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.name === 'string' && typeof candidate.token === 'string'
}

/**
 * Resolves an `Authorization` header value against the admin credential list
 * from `ATEL_ADMIN_CREDENTIALS`. Every configured entry is compared (no early
 * return on match) so match position doesn't leak via timing. Returns the
 * matching entry's `name`, or `undefined` if nothing matches (including when
 * the header is missing/malformed, or `ATEL_ADMIN_CREDENTIALS` is unset/invalid).
 */
export function resolveAdminCredential(
  authHeaderValue: string | undefined,
  env: AdminEnv,
): string | undefined {
  const presented = parseBearerToken(authHeaderValue)
  if (!presented) return undefined
  const entries = parseAdminCredentials(env)
  let matchedName: string | undefined
  for (const entry of entries) {
    if (constantTimeEqual(presented, entry.token)) {
      matchedName = entry.name
    }
  }
  return matchedName
}
