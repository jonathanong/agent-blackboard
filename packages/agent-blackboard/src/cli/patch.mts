import { patchEntry } from '../client/patch.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'

export async function runPatch(argv: string[], ctx: CliContext): Promise<void> {
  const { flags } = parseArgs(argv)
  const sessionId = stringFlag(flags, 'session-id')
  const createdAt = stringFlag(flags, 'created-at')
  const rawData = stringFlag(flags, 'data')
  if (!sessionId) throw new CliError('patch requires --session-id <id>.')
  if (!createdAt) throw new CliError('patch requires --created-at <timestamp>.')
  if (!rawData) throw new CliError('patch requires --data <json>.')
  let data: unknown
  try {
    data = JSON.parse(rawData)
  } catch {
    throw new CliError('--data must be a JSON object.')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CliError('--data must be a JSON object.')
  }
  const entry = await patchEntry(clientConfigFromEnv(ctx.env), {
    sessionId,
    createdAt,
    data: data as Record<string, unknown>,
  })
  writeLine(ctx.stdout, JSON.stringify(entry))
}
