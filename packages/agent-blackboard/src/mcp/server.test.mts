import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
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

it('lists eight tools and returns JSON text or MCP errors', async () => {
  const entry = { sessionId: 's', createdAt: 'now', data: {} }
  const fixture = await startHttpFixture((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/snapshot') {
      sendJson(res, 201, entry)
      return
    }
    const requestUrl = new URL(req.url, 'http://localhost')
    const selection = {
      archived: false,
      ...(requestUrl.searchParams.get('agent') && {
        agent: requestUrl.searchParams.get('agent')!,
      }),
      ...(requestUrl.searchParams.get('version') && {
        version: requestUrl.searchParams.get('version')!,
      }),
      ...(requestUrl.searchParams.has('parentSessionId') && {
        parentSessionId:
          requestUrl.searchParams.get('parentSessionId') === ''
            ? null
            : requestUrl.searchParams.get('parentSessionId')!,
      }),
      ...(requestUrl.searchParams.get('data') && {
        data: JSON.parse(requestUrl.searchParams.get('data')!),
      }),
      ...(requestUrl.searchParams.get('inactiveForHours') && {
        inactiveForHours: Number(requestUrl.searchParams.get('inactiveForHours')),
      }),
    }
    sendNdjson(res, [
      {
        type: 'session',
        session: {
          id: 's',
          parentSessionId: null,
          agent: 'a',
          version: '1',
          createdAt: 'now',
          lastEntryAt: null,
          archivedAt: null,
          data: {},
        },
      },
      {
        type: 'manifest',
        manifest: {
          schemaVersion: 1,
          status: 'complete',
          createdAt: 'now',
          completedAt: 'now',
          selection,
          counts: { sessions: 1, entries: 0, records: 2 },
          ordering: {
            sessions: 'createdAt ascending',
            entries: 'createdAt ascending within session',
          },
          consistency: 'best-effort',
        },
      },
    ])
  })
  try {
    const client = await connectedClient({ baseUrl: fixture.baseUrl, token: 't' })
    const tools = (await client.listTools()).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'entry_append',
      'entry_get',
      'session_archive',
      'session_create',
      'session_ensure',
      'session_patch',
      'session_search',
      'snapshot_export',
    ])
    expect(tools.find((tool) => tool.name === 'session_search')?.inputSchema).toMatchObject({
      properties: {
        archived: { type: 'integer', enum: [0, 1] },
        inactiveForHours: { type: 'number', exclusiveMinimum: 0 },
      },
    })
    const result = await client.callTool({
      name: 'entry_append',
      arguments: { sessionId: 's', data: {} },
    })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(text(result.content))).toEqual(entry)

    const emptySnapshot = await client.callTool({ name: 'snapshot_export', arguments: {} })
    expect(emptySnapshot.isError).toBeFalsy()
    const emptySnapshotResult = JSON.parse(text(emptySnapshot.content)) as { path: string }
    await rm(emptySnapshotResult.path, { force: true })

    const directory = await mkdtemp(join(tmpdir(), 'abb-mcp-snapshot-'))
    const filteredPath = join(directory, 'snapshot.jsonl')
    try {
      const filteredSnapshot = await client.callTool({
        name: 'snapshot_export',
        arguments: {
          path: filteredPath,
          agent: 'a',
          version: '1',
          parentSessionId: null,
          data: { branch: 'main' },
          inactiveForHours: 1,
        },
      })
      expect(filteredSnapshot.isError).toBeFalsy()
      expect(JSON.parse(text(filteredSnapshot.content))).toMatchObject({ path: filteredPath })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    const invalid = await client.callTool({ name: 'entry_append', arguments: { data: {} } })
    expect(invalid.isError).toBe(true)
    expect(text(invalid.content)).toContain('sessionId')
    const unknown = await client.callTool({ name: 'unknown' })
    expect(unknown.isError).toBe(true)
  } finally {
    await fixture.close()
  }
})
