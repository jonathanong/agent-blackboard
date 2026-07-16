import { Telemetry } from '../client/journal.mjs'
import { resolveSessionId } from '../session.mjs'
import { expectObject, optionalString } from './validate.mjs'
import type { ClientConfig, TelemetryEntry } from '../client/types.mjs'

const DEFAULT_AGENT = 'claude-code'

/** `telemetry_append` — args `{ data, sessionId?, agent? }`. */
export async function handleTelemetryAppend(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<TelemetryEntry> {
  const data = expectObject(args.data, 'data')
  const sessionId = resolveSessionId(optionalString(args.sessionId, 'sessionId'))
  const agent = optionalString(args.agent, 'agent') ?? DEFAULT_AGENT
  const telemetry = new Telemetry({
    baseUrl: config.baseUrl,
    token: config.token,
    sessionId,
    agent,
  })
  return telemetry.append(data)
}
