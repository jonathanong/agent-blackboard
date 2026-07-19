import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { createMcpServer } from './server.mjs'

async function connectedClient(config: { baseUrl: string; token: string }): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer(config)
  const client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function text(content: unknown): string {
  return (content as Array<{ text: string }>)[0]!.text
}

it('lists six tools and returns JSON text or MCP errors', async () => {
  const entry = { sessionId: 's', createdAt: 'now', data: {} }
  const fixture = await startHttpFixture((_req, res) => sendJson(res, 201, entry))
  try {
    const client = await connectedClient({ baseUrl: fixture.baseUrl, token: 't' })
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      'entry_append',
      'entry_get',
      'entry_patch',
      'session_archive',
      'session_create',
      'session_patch',
    ])
    const result = await client.callTool({
      name: 'entry_append',
      arguments: { sessionId: 's', data: {} },
    })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(text(result.content))).toEqual(entry)
    const invalid = await client.callTool({ name: 'entry_append', arguments: { data: {} } })
    expect(invalid.isError).toBe(true)
    expect(text(invalid.content)).toContain('sessionId')
    const unknown = await client.callTool({ name: 'unknown' })
    expect(unknown.isError).toBe(true)
  } finally {
    await fixture.close()
  }
})
