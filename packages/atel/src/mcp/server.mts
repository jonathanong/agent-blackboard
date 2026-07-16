import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { formatError } from '../format-error.mjs'
import { dispatchTool } from './dispatch.mjs'
import { TELEMETRY_TOOLS } from './schemas.mjs'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ClientConfig } from '../client/types.mjs'

const SERVER_INFO = { name: 'atel', version: '0.0.0' }

/**
 * Builds the MCP server with the three telemetry tools registered, but does
 * not connect a transport — kept separate so tests can drive it over an
 * `InMemoryTransport` instead of real stdio.
 */
export function createMcpServer(config: ClientConfig): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TELEMETRY_TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      const result = await dispatchTool(request.params.name, request.params.arguments ?? {}, config)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: formatError(err) }], isError: true }
    }
  })

  return server
}

/* v8 ignore start -- real stdio transport; requires an actual MCP client process attached to
   stdin/stdout, which vitest can't drive. `createMcpServer` above (the tested logic) is exercised
   directly via InMemoryTransport in server.test.mts. */
/** Starts the MCP stdio server — the `atel mcp` entrypoint. */
export async function startMcpServer(config: ClientConfig): Promise<void> {
  const server = createMcpServer(config)
  await server.connect(new StdioServerTransport())
}
/* v8 ignore stop */
