import { Telemetries } from '../client/journals.mjs'
import { resolveSessionId } from '../session.mjs'
import { optionalBoolean, optionalEntryFormat, optionalString } from './validate.mjs'
import type { ClientConfig, GetEntriesQuery, TelemetryEntry } from '../client/types.mjs'

/**
 * `telemetry_get` — args `{ sessionId?, agent?, archived?, format? }`.
 * Defaults `sessionId` to the current session (same resolution as
 * `telemetry_append`), so "read back what I just recorded" works with no
 * arguments. Collects the async-iterable client read into a single
 * response, since MCP tool results aren't naturally streaming to the
 * model — the underlying read still streams internally (see
 * `client/stream.mts`), for consistency/reuse with the CLI and library.
 */
export async function handleTelemetryGet(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ entries: TelemetryEntry[] }> {
  const sessionId = resolveSessionId(optionalString(args.sessionId, 'sessionId'))
  const agent = optionalString(args.agent, 'agent')
  const archived = optionalBoolean(args.archived, 'archived')
  const format = optionalEntryFormat(args.format)

  const query: GetEntriesQuery = { sessionId }
  if (agent !== undefined) query.agent = agent
  if (archived !== undefined) query.archived = archived
  if (format !== undefined) query.format = format

  const telemetries = new Telemetries(config)
  const entries: TelemetryEntry[] = []
  for await (const entry of telemetries.get(query)) entries.push(entry)
  return { entries }
}
