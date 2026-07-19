import { Sessions } from '../client/sessions.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'

export async function runSessions(argv: string[], ctx: CliContext): Promise<void> {
  const [subcommand, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const sessions = new Sessions(clientConfigFromEnv(ctx.env))
  if (subcommand === 'create') {
    const id = positional[0]
    if (!id) throw new CliError('sessions create requires <session-id>.')
    const parentSessionId = stringFlag(flags, 'parent-session-id') ?? null
    writeLine(ctx.stdout, JSON.stringify(await sessions.create({ id, parentSessionId })))
    return
  }
  if (subcommand === 'list') {
    writeLine(ctx.stdout, JSON.stringify(await sessions.list()))
    return
  }
  const id = positional[0]
  if (!id) throw new CliError(`sessions ${subcommand ?? '<subcommand>'} requires <session-id>.`)
  if (subcommand === 'get') {
    writeLine(ctx.stdout, JSON.stringify(await sessions.get(id)))
    return
  }
  if (subcommand === 'archive') {
    writeLine(ctx.stdout, JSON.stringify(await sessions.archive(id)))
    return
  }
  throw new CliError('sessions requires one of: create, list, get, archive.')
}
