import { Snapshots } from '../client/snapshots.mjs'
import { cleanupSnapshotPartitions, partitionSnapshot } from '../client/snapshot-partitions.mjs'
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

function requiredString(
  flags: Record<string, string | boolean>,
  key: string,
  command: string,
): string {
  return (
    optionalString(flags, key) ??
    (() => {
      throw new CliError(`${command} requires --${key}.`)
    })()
  )
}

function positiveInteger(flags: Record<string, string | boolean>, key: string): number | undefined {
  const raw = optionalString(flags, key)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CliError(`snapshot partition --${key} must be a positive integer.`)
  }
  return value
}

function nonNegativeInteger(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const raw = optionalString(flags, key)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError(`snapshot partition --${key} must be a non-negative integer.`)
  }
  return value
}

function partitionCounts(flags: Record<string, string | boolean>) {
  const sessions = nonNegativeInteger(flags, 'sessions')
  const entries = nonNegativeInteger(flags, 'entries')
  const records = nonNegativeInteger(flags, 'records')
  const bytes = nonNegativeInteger(flags, 'bytes')
  if ([sessions, entries, records, bytes].some((value) => value !== undefined)) {
    if ([sessions, entries, records, bytes].some((value) => value === undefined)) {
      throw new CliError(
        'snapshot partition count verification requires --sessions, --entries, --records, and --bytes.',
      )
    }
    return { sessions, entries, records, bytes } as {
      sessions: number
      entries: number
      records: number
      bytes: number
    }
  }
  return undefined
}

/** Runs `snapshot export`, keeping JSONL evidence off stdout. */
export async function runSnapshot(argv: string[], ctx: CliContext): Promise<void> {
  const [subcommand, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  if (subcommand === 'partition') {
    if (positional.length > 0) throw new CliError('snapshot partition accepts flags only.')
    const maxSessions = positiveInteger(flags, 'max-sessions')
    const maxBytes = positiveInteger(flags, 'max-bytes')
    const checksum = optionalString(flags, 'checksum')
    const counts = partitionCounts(flags)
    if (checksum !== undefined && !/^[a-f0-9]{64}$/.test(checksum)) {
      throw new CliError('snapshot partition --checksum must be a SHA-256 hex digest.')
    }
    const result = await partitionSnapshot({
      path: requiredString(flags, 'path', 'snapshot partition'),
      ...(maxSessions === undefined ? {} : { maxSessions }),
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(checksum === undefined ? {} : { checksum: { algorithm: 'sha256', value: checksum } }),
      ...(counts === undefined ? {} : { counts }),
    })
    writeLine(ctx.stdout, JSON.stringify(result))
    return
  }
  if (subcommand === 'cleanup') {
    if (positional.length > 0) throw new CliError('snapshot cleanup accepts flags only.')
    await cleanupSnapshotPartitions({
      directory: requiredString(flags, 'directory', 'snapshot cleanup'),
    })
    writeLine(ctx.stdout, JSON.stringify({ removed: true }))
    return
  }
  if (subcommand !== 'export')
    throw new CliError('snapshot requires: export, partition, or cleanup.')
  if (positional.length > 0) throw new CliError('snapshot export accepts flags only.')
  const path = optionalString(flags, 'path')
  const selection = selectionFrom(flags)
  const result = await new Snapshots(clientConfigFromEnv(ctx.env)).export({
    ...(path === undefined ? {} : { path }),
    selection,
  })
  writeLine(ctx.stdout, JSON.stringify(result))
}
