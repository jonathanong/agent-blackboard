import { handleTelemetryAppend } from './tool-append.mjs'
import { handleTelemetryGet } from './tool-get.mjs'
import { handleTelemetryPatch } from './tool-patch.mjs'
import type { ClientConfig } from '../client/types.mjs'

/** Routes a `tools/call` request to the matching handler by tool name. */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  config: ClientConfig,
): Promise<unknown> {
  switch (name) {
    case 'telemetry_append':
      return handleTelemetryAppend(args, config)
    case 'telemetry_get':
      return handleTelemetryGet(args, config)
    case 'telemetry_patch':
      return handleTelemetryPatch(args, config)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
