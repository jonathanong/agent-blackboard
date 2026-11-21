import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { useTempDirs, writePersisted } from '../__tests__/temp-worktree.mjs'
import { createMcpServer } from './server.mjs'
import { withClientHarnessMarker } from './session-resolution.mjs'

const tempDir = useTempDirs()
const cwd = '/nonexistent-agent-blackboard-mcp'

describe('withClientHarnessMarker', () => {
  it('marks Cursor clients and leaves everything else untouched', () => {
    const base = { env: { AGENT_BLACKBOARD_URL: 'u' }, cwd }
    expect(withClientHarnessMarker(base, 'cursor-vscode')).toEqual({
      env: { AGENT_BLACKBOARD_URL: 'u', CURSOR_AGENT: '1' },
      cwd,
    })
    expect(withClientHarnessMarker(base, 'Cursor')?.env.CURSOR_AGENT).toBe('1')
    expect(base.env).toEqual({ AGENT_BLACKBOARD_URL: 'u' })
    expect(withClientHarnessMarker(base, 'claude-code')).toBe(base)
    expect(withClientHarnessMarker(base, undefined)).toBe(base)
    expect(withClientHarnessMarker(undefined, 'cursor-vscode')).toBeUndefined()
    const marked = { env: { CURSOR_AGENT: 'yes' }, cwd }
    expect(withClientHarnessMarker(marked, 'cursor-vscode')).toBe(marked)
  })
})

async function appendWithoutSessionId(clientName: string, root: string): Promise<string[]> {
  const urls: string[] = []
  const fixture = await startHttpFixture((req, res) => {
    urls.push(req.url)
    sendJson(res, 201, { sessionId: 's', createdAt: 'now', data: {} })
  })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer({ baseUrl: fixture.baseUrl, token: 't' }, { env: {}, cwd: root })
    const client = new Client({ name: clientName, version: '1' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const result = await client.callTool({ name: 'entry_append', arguments: { data: {} } })
    if (result.isError) urls.push(`error: ${JSON.stringify(result.content)}`)
    await client.close()
    return urls
  } finally {
    await fixture.close()
  }
}

describe('MCP session resolution for Cursor clients', () => {
  it('falls back to the persisted Cursor id only when the client is Cursor', async () => {
    const root = await tempDir({ git: true })
    await writePersisted(root, 'cursor', 'cursor-persisted\n')

    expect(await appendWithoutSessionId('cursor-vscode', root)).toEqual([
      '/sessions/cursor-persisted/entries',
    ])
    const other = await appendWithoutSessionId('some-client', root)
    expect(other).toHaveLength(1)
    expect(other[0]).toMatch(/^error: .*no session id/)
  })
})
