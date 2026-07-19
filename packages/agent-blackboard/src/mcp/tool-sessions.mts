import { Sessions } from '../client/sessions.mjs'
import { nullableString, requiredString } from './validate.mjs'
import type { ClientConfig, Session } from '../client/types.mjs'

export function handleSessionCreate(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  return new Sessions(config).create({
    id: requiredString(args.sessionId, 'sessionId'),
    parentSessionId: nullableString(args.parentSessionId, 'parentSessionId'),
  })
}

export function handleSessionArchive(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  return new Sessions(config).archive(requiredString(args.sessionId, 'sessionId'))
}
