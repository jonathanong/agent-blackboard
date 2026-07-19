import { patchEntry } from '../client/patch.mjs'
import { expectObject, requiredString } from './validate.mjs'
import type { ClientConfig, SessionEntry } from '../client/types.mjs'

export function handleEntryPatch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<SessionEntry> {
  return patchEntry(config, {
    sessionId: requiredString(args.sessionId, 'sessionId'),
    createdAt: requiredString(args.createdAt, 'createdAt'),
    data: expectObject(args.data, 'data'),
  })
}
