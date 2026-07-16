import { Telemetries } from '../client/journals.mjs'
import { expectObject, optionalBoolean } from './validate.mjs'
import type { ClientConfig, PatchOp, TelemetryEntry } from '../client/types.mjs'

function toPatchOp(value: unknown, index: number): PatchOp {
  const obj = expectObject(value, `patches[${index}]`)
  if (typeof obj.id !== 'string') throw new Error(`patches[${index}].id must be a string.`)
  const patch: PatchOp = { id: obj.id }
  const archived = optionalBoolean(obj.archived, `patches[${index}].archived`)
  if (archived !== undefined) patch.archived = archived
  if (obj.data !== undefined) patch.data = expectObject(obj.data, `patches[${index}].data`)
  return patch
}

/** `telemetry_patch` — args `{ patches: Array<{ id, archived?, data? }> }`. */
export async function handleTelemetryPatch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ patched: TelemetryEntry[] }> {
  if (!Array.isArray(args.patches)) throw new Error('"patches" must be an array.')
  const patches = args.patches.map((item: unknown, index: number) => toPatchOp(item, index))
  const telemetries = new Telemetries(config)
  return { patched: await telemetries.patch(patches) }
}
