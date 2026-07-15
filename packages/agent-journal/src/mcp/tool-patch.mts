import { Journals } from '../client/journals.mjs'
import { expectObject, optionalBoolean } from './validate.mjs'
import type { ClientConfig, JournalEntry, PatchOp } from '../client/types.mjs'

function toPatchOp(value: unknown, index: number): PatchOp {
  const obj = expectObject(value, `patches[${index}]`)
  if (typeof obj.id !== 'string') throw new Error(`patches[${index}].id must be a string.`)
  const patch: PatchOp = { id: obj.id }
  const archived = optionalBoolean(obj.archived, `patches[${index}].archived`)
  if (archived !== undefined) patch.archived = archived
  if (obj.data !== undefined) patch.data = expectObject(obj.data, `patches[${index}].data`)
  return patch
}

/** `journal_patch` — args `{ patches: Array<{ id, archived?, data? }> }`. */
export async function handleJournalPatch(
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<{ patched: JournalEntry[] }> {
  if (!Array.isArray(args.patches)) throw new Error('"patches" must be an array.')
  const patches = args.patches.map((item: unknown, index: number) => toPatchOp(item, index))
  const journals = new Journals(config)
  return { patched: await journals.patch(patches) }
}
