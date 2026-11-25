import { parseSchemaRef, type ParsedSchemaRef } from './id.mjs'

export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema'
const ACCEPTED_DRAFT_URIS = new Set([JSON_SCHEMA_2020_12, `${JSON_SCHEMA_2020_12}#`])

/** Keywords whose values are literal JSON data rather than subschemas. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples'])

export type ValidateSchemaDocumentResult =
  | { ok: true; refs: ParsedSchemaRef[] }
  | { ok: false; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inspectNode(node: unknown, refs: ParsedSchemaRef[]): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const error = inspectNode(item, refs)
      if (error) return error
    }
    return undefined
  }
  if (!isPlainObject(node)) return undefined

  if (typeof node.$dynamicRef === 'string') {
    return '$dynamicRef is not allowed in registered schemas'
  }
  if (typeof node.$id === 'string') {
    return '$id is not allowed in registered schemas; the registry assigns schema identity'
  }
  if (typeof node.$ref === 'string') {
    const hashIndex = node.$ref.indexOf('#')
    const target = hashIndex === -1 ? node.$ref : node.$ref.slice(0, hashIndex)
    if (target.length > 0) {
      const parsed = parseSchemaRef(target)
      if (!parsed) return `remote or invalid $ref is not allowed: ${node.$ref}`
      refs.push(parsed)
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (DATA_KEYWORDS.has(key)) continue
    const error = inspectNode(value, refs)
    if (error) return error
  }
  return undefined
}

/**
 * Validates that a candidate JSON Schema uses JSON Schema 2020-12 only,
 * contains no remote `$ref`, `$dynamicRef`, or `$id`, and extracts all
 * cross-schema references to other registered schemas.
 */
export function validateSchemaDocument(schema: unknown): ValidateSchemaDocumentResult {
  if (!isPlainObject(schema)) {
    return { ok: false, error: 'schema must be a JSON object' }
  }
  if (schema.$schema !== undefined) {
    if (typeof schema.$schema !== 'string' || !ACCEPTED_DRAFT_URIS.has(schema.$schema)) {
      return {
        ok: false,
        error: `unsupported $schema draft; only ${JSON_SCHEMA_2020_12} is allowed`,
      }
    }
  }
  const refs: ParsedSchemaRef[] = []
  const error = inspectNode(schema, refs)
  if (error) return { ok: false, error }
  return { ok: true, refs }
}
