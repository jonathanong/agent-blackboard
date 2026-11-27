import { appendEntry } from '../client/append.mjs'
import { toolSessionId, type SessionResolutionContext } from './session-resolution.mjs'
import { expectObject, optionalPositiveInt, requiredString } from './validate.mjs'
import type { AppendEntryResult, ClientConfig } from '../client/types.mjs'

export function handleEntryAppend(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<AppendEntryResult> {
  const schemaId =
    args.schemaId === undefined ? undefined : requiredString(args.schemaId, 'schemaId')
  const schemaVersion = optionalPositiveInt(args.schemaVersion, 'schemaVersion')
  if (schemaVersion !== undefined && schemaId === undefined) {
    throw new Error('"schemaVersion" requires "schemaId".')
  }
  return appendEntry(config, {
    sessionId: toolSessionId(args, resolution),
    data: expectObject(args.data, 'data'),
    ...(schemaId !== undefined ? { schemaId } : {}),
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
  })
}
