import { streamEntries } from '../client/stream.mjs'
import { optionalEntryFormat, requiredString } from './validate.mjs'
import type { ClientConfig, SessionEntry } from '../client/types.mjs'

export async function handleEntryGet(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ entries: SessionEntry[] }> {
  const entries: SessionEntry[] = []
  const format = optionalEntryFormat(args.format)
  const query = {
    sessionId: requiredString(args.sessionId, 'sessionId'),
    ...(format === undefined ? {} : { format }),
  }
  for await (const entry of streamEntries(config, query)) {
    entries.push(entry)
  }
  return { entries }
}
