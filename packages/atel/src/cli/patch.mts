import { readFileSync } from 'node:fs'
import { Telemetries } from '../client/journals.mjs'
import { parseArgs, parseBooleanFlag, stringFlag } from './args.mjs'
import type { CliContext } from './context.mjs'
import { CliError } from './errors.mjs'
import { telemetryConfigFromEnv } from './env.mjs'
import { writeLine } from './output.mjs'
import type { PatchOp } from '../client/types.mjs'

function loadPatchesFromFile(path: string): PatchOp[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new CliError(`Could not read patch file: ${path}`)
  }
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed))
    throw new CliError(`Patch file must contain a JSON array of patches: ${path}`)
  return parsed as PatchOp[]
}

function buildSinglePatch(id: string, flags: Record<string, string | boolean>): PatchOp {
  const patch: PatchOp = { id }
  const archived = parseBooleanFlag(flags.archived)
  if (archived !== undefined) patch.archived = archived
  const dataFlag = stringFlag(flags, 'data')
  if (dataFlag !== undefined) {
    try {
      patch.data = JSON.parse(dataFlag) as Record<string, unknown>
    } catch {
      throw new CliError('--data must be a JSON object.')
    }
  }
  return patch
}

/**
 * `atel patch <id> [--archived] [--data <json>]` for a single
 * patch, or `atel patch --file <path>` to apply a batch from a
 * JSON array file (each element shaped like `{ id, archived?, data? }`).
 */
export async function runPatch(argv: string[], ctx: CliContext): Promise<void> {
  const { positional, flags } = parseArgs(argv)
  const file = stringFlag(flags, 'file')
  let patches: PatchOp[]
  if (file !== undefined) {
    patches = loadPatchesFromFile(file)
  } else {
    const id = positional[0]
    if (id === undefined)
      throw new CliError('patch requires an <id> argument, or --file <path> for a batch.')
    patches = [buildSinglePatch(id, flags)]
  }
  const telemetries = new Telemetries(telemetryConfigFromEnv(ctx.env))
  const result = await telemetries.patch(patches)
  writeLine(ctx.stdout, JSON.stringify(result))
}
