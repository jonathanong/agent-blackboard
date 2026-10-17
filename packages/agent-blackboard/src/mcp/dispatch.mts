import { handleEntryAppend } from './tool-append.mjs'
import { handleEntryGet } from './tool-get.mjs'
import { handleSnapshotExport } from './tool-snapshot.mjs'
import {
  handleSessionArchive,
  handleSessionCreate,
  handleSessionEnsure,
  handleSessionPatch,
  handleSessionSearch,
} from './tool-sessions.mjs'
import type { ClientConfig } from '../client/types.mjs'
import type { SessionResolutionContext } from './session-resolution.mjs'

export function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  config: ClientConfig,
  resolution?: SessionResolutionContext,
): Promise<unknown> {
  switch (name) {
    case 'session_create':
      return handleSessionCreate(args, config, resolution)
    case 'session_ensure':
      return handleSessionEnsure(args, config, resolution)
    case 'session_archive':
      return handleSessionArchive(args, config)
    case 'session_search':
      return handleSessionSearch(args, config)
    case 'session_patch':
      return handleSessionPatch(args, config)
    case 'entry_append':
      return handleEntryAppend(args, config, resolution)
    case 'entry_get':
      return handleEntryGet(args, config, resolution)
    case 'snapshot_export':
      return handleSnapshotExport(args, config)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
