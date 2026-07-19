import { appendEntry } from '../client/append.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'

async function readStdin(stdin: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export async function runAppend(argv: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(argv)
  const sessionId = stringFlag(flags, 'session-id')
  if (!sessionId) throw new CliError('append requires --session-id <id>.')
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
  const entry = await appendEntry(clientConfigFromEnv(ctx.env), {
    sessionId,
    data: data as Record<string, unknown>,
  })
  writeLine(ctx.stdout, JSON.stringify(entry))
}
