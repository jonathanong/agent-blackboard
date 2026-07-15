import { handleJournalAppend } from './tool-append.mjs'
import { handleJournalGet } from './tool-get.mjs'
import { handleJournalPatch } from './tool-patch.mjs'
import type { ClientConfig } from '../client/types.mjs'

/** Routes a `tools/call` request to the matching handler by tool name. */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<unknown> {
  switch (name) {
    case 'journal_append':
      return handleJournalAppend(args, config)
    case 'journal_get':
      return handleJournalGet(args, config)
    case 'journal_patch':
      return handleJournalPatch(args, config)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
