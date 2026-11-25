const SCHEMA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_SCHEMA_ID_LENGTH = 128
const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/

export interface ParsedSchemaRef {
  id: string
  version?: number
}

/**
 * Validates a schema identifier: starts with an ASCII letter or digit, uses only
 * letters, numbers, `.`, `_`, or `-`, contains no `..`, and is at most 128 chars.
 * Disallowing `:`, `/`, `@`, and `#` prevents URI scheme confusion, path traversal,
 * version-separator ambiguity, and DynamoDB key-delimiter collisions.
 */
export function isValidSchemaId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SCHEMA_ID_LENGTH &&
    !value.includes('..') &&
    SCHEMA_ID_PATTERN.test(value)
  )
}

/** Parses a positive integer version string without leading zeros. */
export function parseSchemaVersion(raw: string): number | undefined {
  if (!POSITIVE_INT_PATTERN.test(raw)) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : undefined
}

/** Parses `<id>` or `<id>@<version>` into structured parts, or `undefined` if invalid. */
export function parseSchemaRef(raw: string): ParsedSchemaRef | undefined {
  const atIndex = raw.indexOf('@')
  if (atIndex === -1) {
    return isValidSchemaId(raw) ? { id: raw } : undefined
  }
  const id = raw.slice(0, atIndex)
  const versionRaw = raw.slice(atIndex + 1)
  if (!isValidSchemaId(id)) return undefined
  const version = parseSchemaVersion(versionRaw)
  return version === undefined ? undefined : { id, version }
}

/** Formats the canonical immutable reference `<id>@<version>`. */
export function formatSchemaRef(id: string, version: number): string {
  return `${id}@${version}`
}
