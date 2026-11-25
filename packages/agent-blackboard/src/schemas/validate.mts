import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type {
  SchemaBundle,
  SchemaValidationIssue,
  SchemaValidationResult,
} from '../client/schema-types.mjs'
import { formatSchemaRef, parseSchemaRef } from './id.mjs'
import { readLocalBundle } from './local-store.mjs'

type FormatsFn = (ajv: Ajv2020) => Ajv2020
const registerFormats = addFormats as unknown as FormatsFn

export function validateAgainstBundle(
  bundle: SchemaBundle,
  schemaRefRaw: string,
  data: unknown,
): SchemaValidationResult {
  const parsed = parseSchemaRef(schemaRefRaw)
  if (!parsed) {
    throw new Error(`Invalid schema reference: ${schemaRefRaw}`)
  }
  const entry = bundle.schemas.find((s) => s.id === parsed.id)
  if (!entry) {
    throw new Error(`Schema not found in local copy: ${parsed.id}`)
  }
  if (entry.deprecatedAt !== null) {
    throw new Error(`Schema is deprecated: ${entry.id}`)
  }
  const targetVersion = parsed.version ?? entry.latestVersion
  const targetRecord = entry.versions.find((v) => v.version === targetVersion)
  if (!targetRecord) {
    throw new Error(
      `Schema version not found in local copy: ${formatSchemaRef(parsed.id, targetVersion)}`,
    )
  }

  const ajv = new Ajv2020({
    strictSchema: true,
    strictTypes: false,
    strictRequired: false,
    allErrors: true,
  })
  registerFormats(ajv)

  for (const schemaEntry of bundle.schemas) {
    for (const ver of schemaEntry.versions) {
      ajv.addSchema(ver.schema, formatSchemaRef(schemaEntry.id, ver.version))
    }
    const latest = schemaEntry.versions.find((v) => v.version === schemaEntry.latestVersion)
    if (latest) {
      ajv.addSchema(latest.schema, schemaEntry.id)
    }
  }

  const ref = formatSchemaRef(entry.id, targetRecord.version)
  const validate = ajv.getSchema(ref)!
  const valid = Boolean(validate(data))
  const errors: SchemaValidationIssue[] = valid
    ? []
    : validate.errors!.map((err) => ({
        instancePath: err.instancePath,
        schemaPath: err.schemaPath,
        keyword: err.keyword,
        message: String(err.message),
      }))

  return { valid, schema: ref, revision: bundle.revision, errors }
}

export function validateAgainstLocalSchemas(
  dir: string,
  schemaRefRaw: string,
  data: unknown,
): SchemaValidationResult {
  const bundle = readLocalBundle(dir)
  if (!bundle) {
    throw new Error(
      `No local schema registry copy found in ${dir}. Run: agent-blackboard schemas pull`,
    )
  }
  return validateAgainstBundle(bundle, schemaRefRaw, data)
}
