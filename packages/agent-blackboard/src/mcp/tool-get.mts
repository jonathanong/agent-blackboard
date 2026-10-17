import { streamEntries } from '../client/stream.mjs'
import { toolSessionId, type SessionResolutionContext } from './session-resolution.mjs'
import { optionalEntryFormat } from './validate.mjs'
import type { ClientConfig, SessionEntry } from '../client/types.mjs'

export async function handleEntryGet(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<{ entries: SessionEntry[] }> {
  const entries: SessionEntry[] = []
  const format = optionalEntryFormat(args.format)
  const query = {
    sessionId: toolSessionId(args, resolution),
    ...(format === undefined ? {} : { format }),
  }
  for await (const entry of streamEntries(config, query)) {
    entries.push(entry)
  }
  return { entries }
}
