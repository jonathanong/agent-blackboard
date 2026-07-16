import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { createMcpServer } from './server.mjs'
import type { ClientConfig } from '../client/types.mjs'

async function connectedClient(config: ClientConfig) {
  const server = createMcpServer(config)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return client
}

function textOf(content: unknown): string {
  return (content as Array<{ type: string; text: string }>)[0]!.text
}

describe('createMcpServer', () => {
  it('lists exactly the three telemetry tools — no credential management', async () => {
    const client = await connectedClient({ baseUrl: 'http://h/', token: 't' })
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'telemetry_append',
      'telemetry_get',
      'telemetry_patch',
    ])
  })

  it('calls telemetry_append and returns the created entry as JSON text content', async () => {
    const entry = {
      id: 'a',
      sessionId: 's1',
      agent: 'claude-code',
      createdAt: 'now',
      archived: false,
      data: {},
    }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, entry))
    try {
      const client = await connectedClient({ baseUrl: fixture.baseUrl, token: 't' })
      const result = await client.callTool({
        name: 'telemetry_append',
        arguments: { data: {}, sessionId: 's1' },
      })
      expect(result.isError).toBeFalsy()
      expect(JSON.parse(textOf(result.content))).toEqual(entry)
    } finally {
      await fixture.close()
    }
  })

  it('defaults missing arguments to {} and surfaces the resulting validation error', async () => {
    const client = await connectedClient({ baseUrl: 'http://h/', token: 't' })
    const result = await client.callTool({ name: 'telemetry_append' })
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toBe('"data" must be an object.')
  })

  it('returns isError: true for an unknown tool name', async () => {
    const client = await connectedClient({ baseUrl: 'http://h/', token: 't' })
    const result = await client.callTool({ name: 'telemetry_delete', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toBe('Unknown tool: telemetry_delete')
  })
})
