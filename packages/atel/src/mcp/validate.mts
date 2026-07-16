import type { TelemetryEntryFormat } from '../client/types.mjs'

/** Shared argument validation for MCP tool handlers — args arrive as untyped JSON. */

export function expectObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`"${field}" must be an object.`)
  }
  return value as Record<string, unknown>
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`"${field}" must be a string.`)
  return value
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`"${field}" must be a boolean.`)
  return value
}

export function optionalEntryFormat(value: unknown): TelemetryEntryFormat | undefined {
  if (value === undefined) return undefined
  if (value === 'json' || value === 'jsonl') return value
  throw new Error('"format" must be "json" or "jsonl".')
}
