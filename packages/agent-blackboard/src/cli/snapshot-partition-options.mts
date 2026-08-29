import { CliError } from './errors.mjs'

type Flags = Record<string, string | boolean>
type OptionalString = (flags: Flags, key: string) => string | undefined

function nonNegativeInteger(raw: string | undefined, key: string): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError(`snapshot partition --${key} must be a non-negative integer.`)
  }
  return value
}

export function partitionCounts(
  flags: Flags,
  optionalString: OptionalString,
): { sessions: number; entries: number; records: number; bytes: number } | undefined {
  const sessions = nonNegativeInteger(optionalString(flags, 'sessions'), 'sessions')
  const entries = nonNegativeInteger(optionalString(flags, 'entries'), 'entries')
  const records = nonNegativeInteger(optionalString(flags, 'records'), 'records')
  const bytes = nonNegativeInteger(optionalString(flags, 'bytes'), 'bytes')
  if ([sessions, entries, records, bytes].every((value) => value === undefined)) return undefined
  if ([sessions, entries, records, bytes].some((value) => value === undefined)) {
    throw new CliError(
      'snapshot partition count verification requires --sessions, --entries, --records, and --bytes.',
    )
  }
  return { sessions: sessions!, entries: entries!, records: records!, bytes: bytes! }
}
