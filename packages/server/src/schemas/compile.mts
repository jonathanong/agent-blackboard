import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { SchemaBundle, SchemaVersionRecord, SchemaWithVersions } from '../core/types.mjs'
import { formatSchemaRef, type ParsedSchemaRef } from './id.mjs'
import { validateSchemaDocument } from './refs.mjs'

type FormatsFn = (ajv: Ajv2020) => Ajv2020
const registerFormats = addFormats as unknown as FormatsFn

export interface CompileTarget {
  id: string
  version: number
  schema: Record<string, unknown>
}

export interface CompileOptions {
  /** Reject references to deprecated schemas (enabled on `put`, disabled when reading/validating old versions). */
  rejectDeprecatedRefs?: boolean
}

export type CompileSchemaResult =
  | { ok: true; validate: ValidateFunction }
  | { ok: false; error: string }

function refKey(ref: ParsedSchemaRef): string {
  return ref.version === undefined ? ref.id : formatSchemaRef(ref.id, ref.version)
}

function resolveRefInBundle(
  ref: ParsedSchemaRef,
  byId: Map<string, SchemaWithVersions>,
  rejectDeprecatedRefs: boolean,
): { ok: true; record: SchemaVersionRecord; key: string } | { ok: false; error: string } {
  const entry = byId.get(ref.id)
  if (!entry) return { ok: false, error: `referenced schema not found: ${refKey(ref)}` }
  if (rejectDeprecatedRefs && entry.deprecatedAt !== null) {
    return { ok: false, error: `referenced schema is deprecated: ${ref.id}` }
  }
  const targetVersion = ref.version ?? entry.latestVersion
  const record = entry.versions.find((v) => v.version === targetVersion)
  if (!record) return { ok: false, error: `referenced schema version not found: ${refKey(ref)}` }
  return { ok: true, record, key: refKey(ref) }
}

/**
 * Compiles a JSON Schema 2020-12 document using Ajv2020 with `ajv-formats`,
 * resolving every cross-schema `$ref` transitively from `bundle` and rejecting
 * unresolved, deprecated (when configured), or cyclic cross-schema references.
 */
export function compileRegisteredSchema(
  target: CompileTarget,
  bundle: SchemaBundle,
  options: CompileOptions = {},
): CompileSchemaResult {
  const checked = validateSchemaDocument(target.schema)
  if (!checked.ok) return checked

  const rejectDeprecatedRefs = options.rejectDeprecatedRefs ?? false
  const byId = new Map<string, SchemaWithVersions>(bundle.schemas.map((s) => [s.id, s]))
  const targetRef = formatSchemaRef(target.id, target.version)
  const resolved = new Map<string, Record<string, unknown>>()
  const visiting = new Set<string>([targetRef])

  function collect(refs: ParsedSchemaRef[]): string | undefined {
    for (const ref of refs) {
      const key = refKey(ref)
      if (key === target.id || key === targetRef || visiting.has(key)) {
        return `circular schema reference: ${key}`
      }
      if (resolved.has(key)) continue
      const found = resolveRefInBundle(ref, byId, rejectDeprecatedRefs)
      if (!found.ok) return found.error
      const depChecked = validateSchemaDocument(found.record.schema)
      if (!depChecked.ok) return depChecked.error
      visiting.add(key)
      const nestedError = collect(depChecked.refs)
      visiting.delete(key)
      if (nestedError) return nestedError
      resolved.set(key, found.record.schema)
    }
    return undefined
  }

  const refError = collect(checked.refs)
  if (refError) return { ok: false, error: refError }

  const ajv = new Ajv2020({
    strictSchema: true,
    strictTypes: false,
    strictRequired: false,
    allErrors: true,
  })
  ajv.addKeyword('$anchor')
  registerFormats(ajv)

  try {
    for (const [key, depSchema] of resolved) {
      ajv.addSchema(structuredClone(depSchema), key)
    }
    const validate = ajv.compile(structuredClone(target.schema))
    return { ok: true, validate }
  } catch (error) {
    return { ok: false, error: `schema failed to compile: ${(error as Error).message}` }
  }
}
