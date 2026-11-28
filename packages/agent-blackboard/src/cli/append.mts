import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { appendEntry } from '../client/append.mjs'
import { resolveOutboxDir } from '../outbox/store.mjs'
import { parseSchemaRef } from '../schemas/id.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { clientConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'
import { createRevisionNotifier } from './revision-notice.mjs'
import { cliSessionId, SESSION_BOOLEAN_FLAGS } from './session-resolution.mjs'

async function readStdin(stdin: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new CliError('append expects a JSON object, either as an argument, file, or stdin.')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CliError('append expects a JSON object (not an array or primitive).')
  }
  return data as Record<string, unknown>
}

async function readFileData(path: string): Promise<Record<string, unknown>> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    throw new CliError(`could not read --file ${path}: ${String(error)}`)
  }
  switch (extname(path).toLowerCase()) {
    case '.json':
      return parseJsonObject(contents)
    case '.md':
    case '.markdown':
      return { markdown: contents }
    case '.txt':
      return { text: contents }
    default:
      throw new CliError('--file must have a .json, .md, .markdown, or .txt extension.')
  }
}

export async function runAppend(argv: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(argv, SESSION_BOOLEAN_FLAGS)
  const sessionId = cliSessionId('append', flags, ctx)
  const file = stringFlag(flags, 'file')
  if (flags.file !== undefined && !file) throw new CliError('append requires a path after --file.')
  if (file && positional.length > 0)
    throw new CliError('append accepts either --file or positional JSON, not both.')
  const schemaFlag = stringFlag(flags, 'schema')
  if (flags.schema !== undefined && !schemaFlag) {
    throw new CliError('append requires <id>[@<version>] after --schema.')
  }
  const parsedSchema = schemaFlag === undefined ? undefined : parseSchemaRef(schemaFlag)
  if (schemaFlag !== undefined && !parsedSchema) {
    throw new CliError(`Invalid --schema reference: ${schemaFlag}`)
  }
  const sourceEventId = stringFlag(flags, 'source-event-id')
  if (flags['source-event-id'] !== undefined && !sourceEventId) {
    throw new CliError('append requires an id after --source-event-id.')
  }
  const data = file
    ? await readFileData(file)
    : parseJsonObject(positional[0] ?? (await readStdin(ctx.stdin)))
  const config = {
    ...clientConfigFromEnv(ctx.env, createRevisionNotifier(ctx)),
    outboxDir: resolveOutboxDir(ctx.cwd, ctx.env),
  }
  const entry = await appendEntry(config, {
    sessionId,
    data,
    ...(parsedSchema ? { schemaId: parsedSchema.id } : {}),
    ...(parsedSchema?.version !== undefined ? { schemaVersion: parsedSchema.version } : {}),
    ...(sourceEventId !== undefined ? { sourceEventId } : {}),
  })
  writeLine(ctx.stdout, JSON.stringify(entry))
}
