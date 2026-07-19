import { appendEntry } from '../client/append.mjs'
import { expectObject, requiredString } from './validate.mjs'
import type { ClientConfig, SessionEntry } from '../client/types.mjs'

export function handleEntryAppend(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<SessionEntry> {
  return appendEntry(config, {
    sessionId: requiredString(args.sessionId, 'sessionId'),
    data: expectObject(args.data, 'data'),
  })
}
