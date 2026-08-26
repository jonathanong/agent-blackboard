import { Snapshots } from '../client/snapshots.mjs'
import type { SnapshotSelection } from '../client/types.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'

function optionalString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = stringFlag(flags, key)
  if (Object.hasOwn(flags, key) && !value)
    throw new CliError(`snapshot export --${key} requires a value.`)
  return value
}

function selectionFrom(flags: Record<string, string | boolean>): SnapshotSelection {
  const agent = optionalString(flags, 'agent')
  const version = optionalString(flags, 'version')
  const parentSessionId = optionalString(flags, 'parent-session-id')
  if (flags['root-only'] !== undefined && parentSessionId !== undefined) {
    throw new CliError('snapshot export --root-only cannot be combined with --parent-session-id.')
  }
  const rawData = optionalString(flags, 'data')
  let data: Record<string, unknown> | undefined
  if (rawData !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rawData)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      data = parsed as Record<string, unknown>
    } catch {
      throw new CliError('snapshot export --data must be a JSON object.')
    }
  }
  const rawHours = optionalString(flags, 'inactive-for-hours')
  const inactiveForHours = rawHours === undefined ? undefined : Number(rawHours)
  if (
    inactiveForHours !== undefined &&
    (!Number.isFinite(inactiveForHours) || inactiveForHours <= 0)
  ) {
    throw new CliError('snapshot export --inactive-for-hours must be a positive number.')
  }
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(version === undefined ? {} : { version }),
    ...(flags['root-only'] === undefined
      ? parentSessionId === undefined
        ? {}
        : { parentSessionId }
      : { parentSessionId: null }),
    ...(data === undefined ? {} : { data }),
    ...(inactiveForHours === undefined ? {} : { inactiveForHours }),
  }
}

/** Runs `snapshot export`, keeping JSONL evidence off stdout. */
export async function runSnapshot(argv: string[], ctx: CliContext): Promise<void> {
  const [subcommand, ...rest] = argv
  if (subcommand !== 'export') throw new CliError('snapshot requires: export.')
  const { positional, flags } = parseArgs(rest)
  if (positional.length > 0) throw new CliError('snapshot export accepts flags only.')
  const path = optionalString(flags, 'path')
  const selection = selectionFrom(flags)
  const result = await new Snapshots(clientConfigFromEnv(ctx.env)).export({
    ...(path === undefined ? {} : { path }),
    selection,
  })
  writeLine(ctx.stdout, JSON.stringify(result))
}
