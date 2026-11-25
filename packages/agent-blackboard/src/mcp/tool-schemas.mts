import { Schemas } from '../client/schemas.mjs'
import type {
  ListSchemasResult,
  PullSchemasResult,
  SchemaValidationResult,
  SchemaVersionDetail,
} from '../client/schema-types.mjs'
import type { ClientConfig } from '../client/types.mjs'
import type { SessionResolutionContext } from './session-resolution.mjs'
import { expectObject, optionalPositiveInt, requiredString } from './validate.mjs'

function localOptions(args: Record<string, unknown>, resolution?: SessionResolutionContext) {
  const dir = args.dir === undefined ? undefined : requiredString(args.dir, 'dir')
  return {
    ...(dir !== undefined ? { dir } : {}),
    ...(resolution?.cwd !== undefined ? { cwd: resolution.cwd } : {}),
    ...(resolution?.env !== undefined ? { env: resolution.env } : {}),
  }
}

export function handleSchemaList(config: ClientConfig): Promise<ListSchemasResult> {
  return new Schemas(config).list()
}

export function handleSchemaGet(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<SchemaVersionDetail> {
  const id = requiredString(args.id, 'id')
  const version = optionalPositiveInt(args.version, 'version')
  return new Schemas(config).get(id, version)
}

export function handleSchemaPull(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<PullSchemasResult> {
  return new Schemas(config).pull(localOptions(args, resolution))
}

export async function handleSchemaValidate(
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<SchemaValidationResult> {
  const schema = requiredString(args.schema, 'schema')
  const data = expectObject(args.data, 'data')
  return new Schemas(config).validateLocal(schema, data, localOptions(args, resolution))
}
