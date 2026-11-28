import { flushOutbox } from '../outbox/client.mjs'
import { getOutboxStatus, pruneOutboxRejected, resolveOutboxDir } from '../outbox/store.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'
import { createRevisionNotifier } from './revision-notice.mjs'

function optionalFlag(
  flags: Record<string, string | boolean>,
  key: string,
  command: string,
): string | undefined {
  const value = stringFlag(flags, key)
  if (Object.hasOwn(flags, key) && !value) {
    throw new CliError(`${command} --${key} requires a value.`)
  }
  return value
}

export async function runOutbox(argv: string[], ctx: CliContext): Promise<void> {
  const [subcommand, ...rest] = argv
  if (!subcommand) throw new CliError('outbox requires: status, flush, or prune.')
  const { positional, flags } = parseArgs(rest)
  if (positional.length > 0) {
    throw new CliError(`outbox ${subcommand} accepts flags only.`)
  }
  const explicitDir = optionalFlag(flags, 'dir', `outbox ${subcommand}`)
  const dir = resolveOutboxDir(ctx.cwd, ctx.env, explicitDir)

  switch (subcommand) {
    case 'status': {
      writeLine(ctx.stdout, JSON.stringify(getOutboxStatus(dir)))
      return
    }
    case 'flush': {
      const sessionId = optionalFlag(flags, 'session-id', 'outbox flush')
      const config = clientConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
      const result = await flushOutbox(config, dir, sessionId !== undefined ? { sessionId } : {})
      writeLine(ctx.stdout, JSON.stringify(result))
      return
    }
    case 'prune': {
      const id = optionalFlag(flags, 'id', 'outbox prune')
      const sessionId = optionalFlag(flags, 'session-id', 'outbox prune')
      const result = pruneOutboxRejected(dir, {
        ...(id !== undefined ? { id } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
      })
      writeLine(ctx.stdout, JSON.stringify(result))
      return
    }
    default:
      throw new CliError('outbox requires: status, flush, or prune.')
  }
}
