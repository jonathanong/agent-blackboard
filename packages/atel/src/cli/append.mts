import { appendEntry } from '../client/append.mjs'
import { resolveSessionId } from '../session.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { CliError } from './errors.mjs'
import { telemetryConfigFromEnv } from './env.mjs'
import { writeLine } from './output.mjs'

const DEFAULT_AGENT = 'claude-code'

async function readStdin(stdin: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `atel append <json>` (or stdin if no argument) — posts one entry. */
export async function runAppend(argv: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(argv)
  const raw = positional[0] ?? (await readStdin(ctx.stdin))
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new CliError('append expects a JSON object, either as an argument or piped via stdin.')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CliError('append expects a JSON object (not an array or primitive).')
  }

  const config = telemetryConfigFromEnv(ctx.env)
  const sessionId = resolveSessionId(stringFlag(flags, 'session-id'), { env: ctx.env })
  const agent = stringFlag(flags, 'agent') ?? DEFAULT_AGENT
  const entry = await appendEntry(config, {
    sessionId,
    agent,
    data: data as Record<string, unknown>,
  })
  writeLine(ctx.stdout, JSON.stringify(entry))
}
