const SCHEMA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_SCHEMA_ID_LENGTH = 128
const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/

export interface ParsedSchemaRef {
  id: string
  version?: number
}

export function isValidSchemaId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SCHEMA_ID_LENGTH &&
    !value.includes('..') &&
    value !== '__proto__' &&
    !Object.hasOwn(Object.prototype, value) &&
    SCHEMA_ID_PATTERN.test(value)
  )
}

export function parseSchemaVersion(raw: string): number | undefined {
  if (!POSITIVE_INT_PATTERN.test(raw)) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : undefined
}

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

export function formatSchemaRef(id: string, version: number): string {
  return `${id}@${version}`
}
