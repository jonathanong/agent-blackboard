import { CliError } from './errors.mjs'
import type { ClientConfig } from '../client/types.mjs'

/** Telemetry config from env — used by `append`/`get`/`patch`. Never the admin token. */
export function telemetryConfigFromEnv(env: NodeJS.ProcessEnv): ClientConfig {
  const baseUrl = env.ATEL_URL
  if (!baseUrl) throw new CliError('ATEL_URL is not set.')
  const token = env.ATEL_TOKEN
  if (!token) throw new CliError('ATEL_TOKEN is not set.')
  return { baseUrl, token }
}

/** Admin config from env — used only by `credentials`. Never the telemetry token. */
export function adminConfigFromEnv(env: NodeJS.ProcessEnv): ClientConfig {
  const baseUrl = env.ATEL_URL
  if (!baseUrl) throw new CliError('ATEL_URL is not set.')
  const token = env.ATEL_ADMIN_TOKEN
  if (!token) throw new CliError('ATEL_ADMIN_TOKEN is not set.')
  return { baseUrl, token }
}
