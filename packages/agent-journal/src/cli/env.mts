import { CliError } from './errors.mjs'
import type { ClientConfig } from '../client/types.mjs'

/** Journaling config from env — used by `append`/`get`/`patch`. Never the admin token. */
export function journalConfigFromEnv(env: NodeJS.ProcessEnv): ClientConfig {
  const baseUrl = env.AGENT_JOURNAL_URL
  if (!baseUrl) throw new CliError('AGENT_JOURNAL_URL is not set.')
  const token = env.AGENT_JOURNAL_TOKEN
  if (!token) throw new CliError('AGENT_JOURNAL_TOKEN is not set.')
  return { baseUrl, token }
}

/** Admin config from env — used only by `credentials`. Never the journaling token. */
export function adminConfigFromEnv(env: NodeJS.ProcessEnv): ClientConfig {
  const baseUrl = env.AGENT_JOURNAL_URL
  if (!baseUrl) throw new CliError('AGENT_JOURNAL_URL is not set.')
  const token = env.AGENT_JOURNAL_ADMIN_TOKEN
  if (!token) throw new CliError('AGENT_JOURNAL_ADMIN_TOKEN is not set.')
  return { baseUrl, token }
}
