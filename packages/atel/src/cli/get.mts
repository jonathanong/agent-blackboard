import { fetchTelemetriesRaw } from '../client/stream.mjs'
import { resolveSessionId } from '../session.mjs'
import { parseArgs, parseBooleanFlag, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { CliError } from './errors.mjs'
import { telemetryConfigFromEnv } from './env.mjs'
import type { GetRawQuery, TelemetryWireFormat } from '../client/types.mjs'

const VALID_FORMATS: readonly TelemetryWireFormat[] = ['json', 'jsonl', 'markdown']

function parseFormatFlag(value: string | boolean | undefined): TelemetryWireFormat | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && (VALID_FORMATS as readonly string[]).includes(value)) {
    return value as TelemetryWireFormat
  }
  throw new CliError(`--format must be one of: ${VALID_FORMATS.join(', ')}`)
}

/**
 * `atel get [--session-id] [--agent] [--archived] [--format]` —
 * streams the raw response body to stdout as it arrives, in whatever wire
 * format was requested (default `json`). By default this resolves and
 * filters to the current session, same as `append`; pass `--all-sessions`
 * to read across every session visible to this credential.
 */
export async function runGet(argv: string[], ctx: CliContext): Promise<void> {
  const { flags } = parseArgs(argv)
  const config = telemetryConfigFromEnv(ctx.env)
  const format = parseFormatFlag(flags.format) ?? 'json'
  const sessionId =
    flags['all-sessions'] === true
      ? undefined
      : resolveSessionId(stringFlag(flags, 'session-id'), { env: ctx.env })
  const agent = stringFlag(flags, 'agent')
  const archived = parseBooleanFlag(flags.archived)

  const query: GetRawQuery = { format }
  if (sessionId !== undefined) query.sessionId = sessionId
  if (agent !== undefined) query.agent = agent
  if (archived !== undefined) query.archived = archived

  const response = await fetchTelemetriesRaw(config, query)
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (value) ctx.stdout.write(decoder.decode(value, { stream: true }))
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
