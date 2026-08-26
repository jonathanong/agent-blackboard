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

function parentSelection(
  flags: Record<string, string | boolean>,
): Pick<SnapshotSelection, 'parentSessionId'> {
  const parentSessionId = optionalString(flags, 'parent-session-id')
  if (flags['root-only'] !== undefined && parentSessionId !== undefined) {
    throw new CliError('snapshot export --root-only cannot be combined with --parent-session-id.')
  }
  if (parentSessionId !== undefined && !/^[A-Za-z0-9._:-]+$/.test(parentSessionId)) {
    throw new CliError('snapshot export --parent-session-id is invalid.')
  }
  if (flags['root-only'] !== undefined) return { parentSessionId: null }
  return parentSessionId === undefined ? {} : { parentSessionId }
}

function dataSelection(
  flags: Record<string, string | boolean>,
): Record<string, unknown> | undefined {
  const rawData = optionalString(flags, 'data')
  if (rawData === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(rawData)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new CliError('snapshot export --data must be a JSON object.')
  }
}

function inactivitySelection(flags: Record<string, string | boolean>): number | undefined {
  const rawHours = optionalString(flags, 'inactive-for-hours')
  if (rawHours === undefined) return undefined
  const hours = Number(rawHours)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new CliError('snapshot export --inactive-for-hours must be a positive number.')
  }
  return hours
}

function selectionFrom(flags: Record<string, string | boolean>): SnapshotSelection {
  const agent = optionalString(flags, 'agent')
  const version = optionalString(flags, 'version')
  const data = dataSelection(flags)
  const inactiveForHours = inactivitySelection(flags)
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(version === undefined ? {} : { version }),
    ...parentSelection(flags),
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
