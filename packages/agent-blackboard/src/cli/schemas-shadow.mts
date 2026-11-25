import { getSchemaReportRequest, promoteSchemaRequest } from '../client/schemas-client.mjs'
import { parseSchemaRef } from '../schemas/id.mjs'
import { parseArgs, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { adminConfigFromEnv } from './env.mjs'
import { CliError } from './errors.mjs'
import { writeLine } from './output.mjs'
import { createRevisionNotifier } from './revision-notice.mjs'

const MAX_REPORT_LIMIT = 100

function parseLimitFlag(flags: Record<string, string | boolean>): number | undefined {
  if (!Object.hasOwn(flags, 'limit')) return undefined
  const raw = stringFlag(flags, 'limit')
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) {
    throw new CliError(
      `schemas report --limit must be an integer between 1 and ${MAX_REPORT_LIMIT}.`,
    )
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed > MAX_REPORT_LIMIT) {
    throw new CliError(
      `schemas report --limit must be an integer between 1 and ${MAX_REPORT_LIMIT}.`,
    )
  }
  return parsed
}

export async function runPromote(args: string[], ctx: CliContext): Promise<void> {
  const { positional } = parseArgs(args)
  const [refRaw] = positional
  if (!refRaw) throw new CliError('schemas promote requires <id>@<version>.')
  const parsed = parseSchemaRef(refRaw)
  if (!parsed || parsed.version === undefined) {
    throw new CliError(`schemas promote requires an explicit version (<id>@<version>): ${refRaw}`)
  }
  const config = adminConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
  const result = await promoteSchemaRequest(config, parsed.id, parsed.version)
  writeLine(ctx.stdout, JSON.stringify(result))
}

export async function runReport(args: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(args)
  const [refRaw] = positional
  if (!refRaw) throw new CliError('schemas report requires <id>[@<version>].')
  const parsed = parseSchemaRef(refRaw)
  if (!parsed) throw new CliError(`Invalid schema reference: ${refRaw}`)
  const limit = parseLimitFlag(flags)
  const config = adminConfigFromEnv(ctx.env, createRevisionNotifier(ctx))
  const result = await getSchemaReportRequest(config, parsed.id, parsed.version, limit)
  writeLine(ctx.stdout, JSON.stringify(result))
}
