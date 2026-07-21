import type { StructuredEntryFormat } from '../client/types.mjs'

export function expectObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`"${field}" must be an object.`)
  }
  return value as Record<string, unknown>
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`"${field}" must be a non-empty string.`)
  }
  return value
}

export function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null
  return requiredString(value, field)
}

export function optionalEntryFormat(value: unknown): StructuredEntryFormat | undefined {
  if (value === undefined) return undefined
  if (value === 'json' || value === 'jsonl') return value
  throw new Error('"format" must be "json" or "jsonl".')
}

export function optionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`"${field}" must be a positive integer.`)
  }
  return value
}
