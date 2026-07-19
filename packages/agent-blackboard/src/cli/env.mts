import { CliError } from './errors.mjs'
import type { ClientConfig } from '../client/types.mjs'

/** Client config from env — used by session and entry commands. Never the admin token. */
export function clientConfigFromEnv(env: NodeJS.ProcessEnv): ClientConfig {
  const baseUrl = env.AGENT_BLACKBOARD_URL
  if (!baseUrl) throw new CliError('AGENT_BLACKBOARD_URL is not set.')
  const token = env.AGENT_BLACKBOARD_TOKEN
  if (!token) throw new CliError('AGENT_BLACKBOARD_TOKEN is not set.')
  return { baseUrl, token }
}

/** Admin config from env — used only by `credentials`. Never the client token. */
export function adminConfigFromEnv(env: NodeJS.ProcessEnv): ClientConfig {
  const baseUrl = env.AGENT_BLACKBOARD_URL
  if (!baseUrl) throw new CliError('AGENT_BLACKBOARD_URL is not set.')
  const token = env.AGENT_BLACKBOARD_ADMIN_TOKEN
  if (!token) throw new CliError('AGENT_BLACKBOARD_ADMIN_TOKEN is not set.')
  return { baseUrl, token }
}
