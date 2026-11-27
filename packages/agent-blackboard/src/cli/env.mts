import { CliError } from './errors.mjs'
import type { ClientConfig } from '../client/types.mjs'

/** Client config from env — used by session, entry, and schema-read commands. Never the admin token. */
export function clientConfigFromEnv(
  env: NodeJS.ProcessEnv,
  onSchemaRevision?: (revision: number) => void,
): ClientConfig {
  const baseUrl = env.AGENT_BLACKBOARD_URL
  if (!baseUrl) throw new CliError('AGENT_BLACKBOARD_URL is not set.')
  const token = env.AGENT_BLACKBOARD_TOKEN
  if (!token) throw new CliError('AGENT_BLACKBOARD_TOKEN is not set.')
  return onSchemaRevision === undefined ? { baseUrl, token } : { baseUrl, token, onSchemaRevision }
}

/** Admin config from env — used only by `credentials` and schema write commands. Never the client token. */
export function adminConfigFromEnv(
  env: NodeJS.ProcessEnv,
  onSchemaRevision?: (revision: number) => void,
): ClientConfig {
  const baseUrl = env.AGENT_BLACKBOARD_URL
  if (!baseUrl) throw new CliError('AGENT_BLACKBOARD_URL is not set.')
  const token = env.AGENT_BLACKBOARD_ADMIN_TOKEN
  if (!token) throw new CliError('AGENT_BLACKBOARD_ADMIN_TOKEN is not set.')
  return onSchemaRevision === undefined ? { baseUrl, token } : { baseUrl, token, onSchemaRevision }
}
