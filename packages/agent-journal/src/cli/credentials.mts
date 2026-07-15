import { Auth } from '../client/auth.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { CliError } from './errors.mjs'
import { adminConfigFromEnv } from './env.mjs'
import { writeLine } from './output.mjs'

/**
 * `agent-journal credentials create|list|delete` — admin-only, uses
 * `AGENT_JOURNAL_ADMIN_TOKEN`. Never exposed over MCP.
 */
export async function runCredentials(argv: string[], ctx: CliContext): Promise<void> {
  const [sub, ...rest] = argv
  const { flags } = parseArgs(rest)
  const config = adminConfigFromEnv(ctx.env)
  const auth = new Auth({ baseUrl: config.baseUrl, adminToken: config.token })

  switch (sub) {
    case 'create': {
      const name = stringFlag(flags, 'name')
      if (name === undefined) throw new CliError('credentials create requires --name <name>.')
      writeLine(ctx.stdout, JSON.stringify(await auth.createCredentials({ name })))
      return
    }
    case 'list': {
      writeLine(ctx.stdout, JSON.stringify(await auth.listCredentials()))
      return
    }
    case 'delete': {
      const id = stringFlag(flags, 'id')
      const name = stringFlag(flags, 'name')
      if (id !== undefined) {
        await auth.deleteCredentials({ id })
      } else if (name !== undefined) {
        await auth.deleteCredentials({ name })
      } else {
        throw new CliError('credentials delete requires --id <id> or --name <name>.')
      }
      writeLine(ctx.stdout, JSON.stringify({ deleted: true }))
      return
    }
    default:
      throw new CliError(
        `Unknown credentials subcommand: ${sub ?? '(none)'}. Expected one of: create, list, delete.`,
      )
  }
}
