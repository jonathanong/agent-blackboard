import { Journals } from '../client/journals.mjs'
import { resolveSessionId } from '../session.mjs'
import { optionalBoolean, optionalEntryFormat, optionalString } from './validate.mjs'
import type { ClientConfig, GetEntriesQuery, JournalEntry } from '../client/types.mjs'

/**
 * `journal_get` — args `{ sessionId?, agent?, archived?, format? }`.
 * Defaults `sessionId` to the current session (same resolution as
 * `journal_append`), so "read back what I just journaled" works with no
 * arguments. Collects the async-iterable client read into a single
 * response, since MCP tool results aren't naturally streaming to the
 * model — the underlying read still streams internally (see
 * `client/stream.mts`), for consistency/reuse with the CLI and library.
 */
export async function handleJournalGet(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ entries: JournalEntry[] }> {
  const sessionId = resolveSessionId(optionalString(args.sessionId, 'sessionId'))
  const agent = optionalString(args.agent, 'agent')
  const archived = optionalBoolean(args.archived, 'archived')
  const format = optionalEntryFormat(args.format)

  const query: GetEntriesQuery = { sessionId }
  if (agent !== undefined) query.agent = agent
  if (archived !== undefined) query.archived = archived
  if (format !== undefined) query.format = format

  const journals = new Journals(config)
  const entries: JournalEntry[] = []
  for await (const entry of journals.get(query)) entries.push(entry)
  return { entries }
}
