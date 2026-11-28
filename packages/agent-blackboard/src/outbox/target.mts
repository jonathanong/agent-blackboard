import type { ClientConfig } from '../client/types.mjs'
import type { OutboxTarget } from './types.mjs'

const CLIENT_TOKEN_CRED_ID = /^abb_sk_([^_]+)_/
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Derives a non-secret target namespace from client configuration so queued outbox entries
 * are only flushed to the server and credential namespace that queued them. Never stores
 * the raw token or secret.
 */
export function outboxTargetFromConfig(
  config: Pick<ClientConfig, 'baseUrl' | 'token'>,
): OutboxTarget {
  const url = new URL(config.baseUrl)
  const server = LOOPBACK_HOSTS.has(url.hostname) ? 'loopback' : url.origin
  const match = CLIENT_TOKEN_CRED_ID.exec(config.token)
  return match?.[1] ? { server, credentialId: match[1] } : { server }
}

/** Returns true when a queued record's target matches the active client configuration. */
export function matchesOutboxTarget(
  recorded: OutboxTarget | undefined,
  current: OutboxTarget,
): boolean {
  if (!recorded) return true
  if (recorded.server !== current.server) return false
  return (recorded.credentialId ?? null) === (current.credentialId ?? null)
}
