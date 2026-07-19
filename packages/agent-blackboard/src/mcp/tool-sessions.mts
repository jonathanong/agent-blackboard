import { Sessions } from '../client/sessions.mjs'
import { expectObject, nullableString, requiredString } from './validate.mjs'
import type { ClientConfig, Session } from '../client/types.mjs'

export function handleSessionCreate(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  return new Sessions(config).create({
    id: requiredString(args.sessionId, 'sessionId'),
    parentSessionId: nullableString(args.parentSessionId, 'parentSessionId'),
    agent: requiredString(args.agent, 'agent'),
    version: requiredString(args.version, 'version'),
  })
}

export function handleSessionPatch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  const data = expectObject(args.data, 'data')
  if (Object.keys(data).length === 0) throw new Error('data must be a non-empty object')
  return new Sessions(config).patch({
    sessionId: requiredString(args.sessionId, 'sessionId'),
    data,
  })
}

export function handleSessionArchive(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<Session> {
  return new Sessions(config).archive(requiredString(args.sessionId, 'sessionId'))
}
