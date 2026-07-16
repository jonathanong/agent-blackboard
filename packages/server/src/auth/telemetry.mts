import type { CredentialRecord } from '../core/types.mjs'
import { constantTimeEqual } from './constant-time.mjs'
import { hashToken } from './hash.mjs'
import { parseBearerToken } from './parse-bearer.mjs'
import { parseTelemetryToken } from './tokens.mjs'

/**
 * The minimal store surface this resolver needs — a structural subset of
 * `TelemetryStore`, kept local so `auth/**` never has to import from `store/**`.
 */
export interface CredentialLookup {
  getCredentialById(id: string): Promise<CredentialRecord | undefined>
}

/**
 * Resolves an `Authorization` header value to a telemetry `CredentialRecord`:
 * parses `atl_sk_<credId>_<secret>` (rejecting anything else, including
 * admin-shaped tokens, without touching the store), looks up `credId`, then
 * constant-time-compares `sha256(presented)` against the stored hash.
 */
export async function resolveTelemetryCredential(
  authHeaderValue: string | undefined,
  store: CredentialLookup,
): Promise<CredentialRecord | undefined> {
  const presented = parseBearerToken(authHeaderValue)
  if (!presented) return undefined
  const parsed = parseTelemetryToken(presented)
  if (!parsed) return undefined
  const record = await store.getCredentialById(parsed.credId)
  if (!record) return undefined
  if (!constantTimeEqual(hashToken(presented), record.tokenHash)) return undefined
  return record
}
