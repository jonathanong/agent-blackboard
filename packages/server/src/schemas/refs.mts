import { parseSchemaRef, type ParsedSchemaRef } from './id.mjs'

export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema'
const ACCEPTED_DRAFT_URIS = new Set([JSON_SCHEMA_2020_12, `${JSON_SCHEMA_2020_12}#`])

/** Keywords at schema nodes whose values are literal JSON data rather than subschemas. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples'])

/** Keywords whose values are maps from arbitrary property/def names to subschemas. */
const SCHEMA_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
])

export type ValidateSchemaDocumentResult =
  | { ok: true; refs: ParsedSchemaRef[] }
  | { ok: false; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inspectSchemaMap(
  map: Record<string, unknown>,
  refs: ParsedSchemaRef[],
): string | undefined {
  for (const subschema of Object.values(map)) {
    const error = inspectSchemaNode(subschema, refs)
    if (error) return error
  }
  return undefined
}

function inspectSchemaNode(node: unknown, refs: ParsedSchemaRef[]): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const error = inspectSchemaNode(item, refs)
      if (error) return error
    }
    return undefined
  }
  if (!isPlainObject(node)) return undefined

  if (node.$schema !== undefined) {
    if (typeof node.$schema !== 'string' || !ACCEPTED_DRAFT_URIS.has(node.$schema)) {
      return `unsupported $schema draft; only ${JSON_SCHEMA_2020_12} is allowed`
    }
  }
  if (node.$dynamicRef !== undefined) {
    return '$dynamicRef is not allowed in registered schemas'
  }
  if (node.$id !== undefined) {
    return '$id is not allowed in registered schemas; the registry assigns schema identity'
  }
  if (node.$ref !== undefined) {
    if (typeof node.$ref !== 'string') return '$ref must be a string'
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
    const error =
      SCHEMA_MAP_KEYWORDS.has(key) && isPlainObject(value)
        ? inspectSchemaMap(value, refs)
        : inspectSchemaNode(value, refs)
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
  const refs: ParsedSchemaRef[] = []
  const error = inspectSchemaNode(schema, refs)
  if (error) return { ok: false, error }
  return { ok: true, refs }
}
