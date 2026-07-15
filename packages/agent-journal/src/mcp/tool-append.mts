import { Journal } from '../client/journal.mjs'
import { resolveSessionId } from '../session.mjs'
import { expectObject, optionalString } from './validate.mjs'
import type { ClientConfig, JournalEntry } from '../client/types.mjs'

const DEFAULT_AGENT = 'claude-code'

/** `journal_append` — args `{ data, sessionId?, agent? }`. */
export async function handleJournalAppend(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<JournalEntry> {
  const data = expectObject(args.data, 'data')
  const sessionId = resolveSessionId(optionalString(args.sessionId, 'sessionId'))
  const agent = optionalString(args.agent, 'agent') ?? DEFAULT_AGENT
  const journal = new Journal({ baseUrl: config.baseUrl, token: config.token, sessionId, agent })
  return journal.append(data)
}
