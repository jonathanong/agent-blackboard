import type { ClientConfig } from '../client/types.mjs'
import { Outbox } from '../outbox/client.mjs'
import type { OutboxFlushResult, OutboxPruneResult, OutboxStatus } from '../outbox/types.mjs'
import type { SessionResolutionContext } from './session-resolution.mjs'
import { requiredString } from './validate.mjs'

function locationOptions(args: Record<string, unknown>, resolution?: SessionResolutionContext) {
  const dir = args.dir === undefined ? undefined : requiredString(args.dir, 'dir')
  return {
    ...(dir !== undefined ? { dir } : {}),
    ...(resolution?.cwd !== undefined ? { cwd: resolution.cwd } : {}),
    ...(resolution?.env !== undefined ? { env: resolution.env } : {}),
  }
}

export async function handleOutboxStatus(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<OutboxStatus> {
  return new Outbox(config).status(locationOptions(args, resolution))
}

export function handleOutboxFlush(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<OutboxFlushResult> {
  const sessionId =
    args.sessionId === undefined ? undefined : requiredString(args.sessionId, 'sessionId')
  return new Outbox(config).flush({
    ...locationOptions(args, resolution),
    ...(sessionId !== undefined ? { sessionId } : {}),
  })
}

export async function handleOutboxPruneRejected(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<OutboxPruneResult> {
  const id = args.id === undefined ? undefined : requiredString(args.id, 'id')
  const sessionId =
    args.sessionId === undefined ? undefined : requiredString(args.sessionId, 'sessionId')
  return new Outbox(config).pruneRejected({
    ...locationOptions(args, resolution),
    ...(id !== undefined ? { id } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  })
}
