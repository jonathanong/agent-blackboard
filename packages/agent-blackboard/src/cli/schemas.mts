import { readFile } from 'node:fs/promises'
import type { PullSchemasResult } from '../client/schema-types.mjs'
import {
  deprecateSchemaRequest,
  fetchSchemaBundleRequest,
  getSchemaRequest,
  listSchemasRequest,
  putSchemaRequest,
} from '../client/schemas-client.mjs'
import { isValidSchemaId, parseSchemaRef } from '../schemas/id.mjs'
import { readLocalBundle, resolveSchemasDir, writeLocalBundle } from '../schemas/local-store.mjs'
import { validateAgainstLocalSchemas } from '../schemas/validate.mjs'
import { parseArgs, stringFlag, type ParsedArgs } from './args.mjs'
import type { CliContext } from './context.mjs'
import { adminConfigFromEnv, clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'
import { createRevisionNotifier } from './revision-notice.mjs'

const PUT_BOOLEAN_FLAGS = new Set(['breaking'])

function optionalDirFlag(flags: ParsedArgs['flags'], subcommand: string): string | undefined {
  const dir = stringFlag(flags, 'dir')
  if (Object.hasOwn(flags, 'dir') && !dir) {
    throw new CliError(`schemas ${subcommand} requires a path after --dir.`)
  }
  return dir
}

function parseBreakingFlag(flags: ParsedArgs['flags']): boolean {
  const raw = flags.breaking
  if (raw === undefined || raw === false || raw === 'false') return false
  if (raw === true || raw === 'true') return true
  throw new CliError('schemas put --breaking must be a boolean flag.')
}

async function readJsonObjectFile(
  filePath: string,
  label: string,
): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    throw new CliError(`could not read ${label} ${filePath}: ${String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new CliError(`${label} ${filePath} must contain valid JSON.`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`${label} ${filePath} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

async function runPull(args: string[], ctx: CliContext): Promise<void> {
  const { flags } = parseArgs(args)
  const dir = resolveSchemasDir(ctx.cwd, ctx.env, optionalDirFlag(flags, 'pull'))
  // Validate the full local bundle before sending If-None-Match so a missing/corrupt version file heals on pull.
  const local = readLocalBundle(dir)
  const config = clientConfigFromEnv(ctx.env)
  const fetched = await fetchSchemaBundleRequest(config, local?.revision)
  if (fetched.notModified) {
    const versionCount = local
      ? local.schemas.reduce((sum, item) => sum + item.versions.length, 0)
      : 0
    const result: PullSchemasResult = {
      upToDate: true,
      revision: fetched.revision,
      schemaCount: local?.schemas.length ?? 0,
      versionCount,
      dir,
    }
    writeLine(ctx.stdout, JSON.stringify(result))
    return
  }
  const counts = writeLocalBundle(dir, fetched.bundle)
  const result: PullSchemasResult = {
    upToDate: false,
    revision: fetched.bundle.revision,
    schemaCount: counts.schemaCount,
    versionCount: counts.versionCount,
    dir,
  }
  writeLine(ctx.stdout, JSON.stringify(result))
}

async function runPut(args: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(args, PUT_BOOLEAN_FLAGS)
  const [id, filePath] = positional
  if (!id || !filePath) throw new CliError('schemas put requires <id> <file>.')
  if (!isValidSchemaId(id)) throw new CliError(`Invalid schema id: ${id}`)
  const breaking = parseBreakingFlag(flags)
  const schema = await readJsonObjectFile(filePath, 'schema file')
  const config = adminConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
  const result = await putSchemaRequest(config, id, {
    schema,
    ...(breaking ? { breaking: true } : {}),
  })
  writeLine(ctx.stdout, JSON.stringify(result))
}

async function runRemove(args: string[], ctx: CliContext): Promise<void> {
  const { positional } = parseArgs(args)
  const [id] = positional
  if (!id) throw new CliError('schemas remove requires <id>.')
  if (!isValidSchemaId(id)) throw new CliError(`Invalid schema id: ${id}`)
  const config = adminConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
  const result = await deprecateSchemaRequest(config, id)
  writeLine(ctx.stdout, JSON.stringify(result))
}

async function runList(ctx: CliContext): Promise<void> {
  const config = clientConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
  writeLine(ctx.stdout, JSON.stringify(await listSchemasRequest(config)))
}

async function runGet(args: string[], ctx: CliContext): Promise<void> {
  const { positional } = parseArgs(args)
  const [refRaw] = positional
  if (!refRaw) throw new CliError('schemas get requires <id>[@<version>].')
  const parsed = parseSchemaRef(refRaw)
  if (!parsed) throw new CliError(`Invalid schema reference: ${refRaw}`)
  const config = clientConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
  writeLine(ctx.stdout, JSON.stringify(await getSchemaRequest(config, parsed.id, parsed.version)))
}

async function runValidate(args: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(args)
  const [schemaRef, filePath] = positional
  if (!schemaRef || !filePath) {
    throw new CliError('schemas validate requires <schema-id>[@<version>] <file>.')
  }
  const dir = resolveSchemasDir(ctx.cwd, ctx.env, optionalDirFlag(flags, 'validate'))
  const payload = await readJsonObjectFile(filePath, 'entry file')
  const result = validateAgainstLocalSchemas(dir, schemaRef, payload)
  writeLine(ctx.stdout, JSON.stringify(result))
  if (!result.valid) {
    throw new CliError(`entry failed validation against ${result.schema}`)
  }
}

export async function runSchemas(argv: string[], ctx: CliContext): Promise<void> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'pull':
      await runPull(rest, ctx)
      return
    case 'put':
      await runPut(rest, ctx)
      return
    case 'remove':
      await runRemove(rest, ctx)
      return
    case 'list':
      await runList(ctx)
      return
    case 'get':
      await runGet(rest, ctx)
      return
    case 'validate':
      await runValidate(rest, ctx)
      return
    default:
      throw new CliError(
        `Unknown schemas subcommand: ${sub ?? '(none)'}. Expected one of: pull, put, remove, list, get, validate.`,
      )
  }
}
