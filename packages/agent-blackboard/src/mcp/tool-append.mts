import { appendEntry } from '../client/append.mjs'
import { toolSessionId, type SessionResolutionContext } from './session-resolution.mjs'
import { expectObject } from './validate.mjs'
import type { ClientConfig, SessionEntry } from '../client/types.mjs'

export function handleEntryAppend(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<SessionEntry> {
  return appendEntry(config, {
    sessionId: toolSessionId(args, resolution),
    data: expectObject(args.data, 'data'),
  })
}
