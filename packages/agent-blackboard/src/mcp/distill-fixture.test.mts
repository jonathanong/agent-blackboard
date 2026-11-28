import { access, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import type { SnapshotExportResult, SnapshotPartitionResult } from '../client/snapshot-types.mjs'
import { dispatchTool } from './dispatch.mjs'
import { ENTRY_TOOLS } from './schemas.mjs'

const REPO_ROOT = new URL('../../../../', import.meta.url)
const SKILL_PATH = new URL('plugins/agent-blackboard/skills/distill/SKILL.md', REPO_ROOT)
const REF_PATH = new URL(
  'plugins/agent-blackboard/skills/distill/references/output-schema.md',
  REPO_ROOT,
)
const FIXTURE_PATH = new URL('../__tests__/fixtures/distill-snapshot.jsonl', import.meta.url)

describe('plugin distill skill', () => {
  it('ships valid skill metadata, references, and real MCP tool names in the plugin', async () => {
    const skillText = await readFile(SKILL_PATH, 'utf8')
    const refText = await readFile(REF_PATH, 'utf8')
    const claudePlugin = JSON.parse(
      await readFile(new URL('.claude-plugin/plugin.json', REPO_ROOT), 'utf8'),
    ) as { skills: string }
    const codexPlugin = JSON.parse(
      await readFile(
        new URL('plugins/agent-blackboard/.codex-plugin/plugin.json', REPO_ROOT),
        'utf8',
      ),
    ) as { skills: string }

    expect(claudePlugin.skills).toBe('./plugins/agent-blackboard/skills/')
    expect(codexPlugin.skills).toBe('./skills/')
    expect(skillText).toMatch(/^---\nname: distill\ndescription: (.+)\n---/)
    const description = /^---\nname: distill\ndescription: (.+)\n---/.exec(skillText)![1]!
    expect(description.length).toBeLessThanOrEqual(400)
    expect(skillText).toContain('references/output-schema.md')
    expect(refText).toContain('"followUps"')

    const mcpToolNames = new Set(ENTRY_TOOLS.map((tool) => tool.name))
    for (const toolName of [
      'snapshot_export',
      'snapshot_partition',
      'snapshot_cleanup',
      'session_search',
      'session_archive',
    ]) {
      expect(mcpToolNames.has(toolName)).toBe(true)
      expect(skillText).toContain(toolName)
    }
  })

  it('runs the MCP snapshot export, partition, session verification/archive, and cleanup sequence with zero leftover files', async () => {
    const recordedSnapshot = await readFile(fileURLToPath(FIXTURE_PATH), 'utf8')
    const archivedIds: string[] = []
    const fixture = await startHttpFixture((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/snapshot') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.end(recordedSnapshot)
        return
      }
      if (req.method === 'GET' && url.pathname === '/sessions/sess-1') {
        sendJson(res, 200, {
          id: 'sess-1',
          parentSessionId: null,
          agent: 'claude-code',
          version: '1.0.0',
          createdAt: '2026-01-01T01:00:00.000Z',
          lastEntryAt: '2026-01-01T01:05:00.000Z',
          archivedAt: null,
          data: { repositories: ['org/app'] },
        })
        return
      }
      if (req.method === 'PATCH' && url.pathname.startsWith('/sessions/')) {
        const id = decodeURIComponent(url.pathname.slice('/sessions/'.length))
        archivedIds.push(id)
        sendJson(res, 200, {
          id,
          parentSessionId: null,
          agent: 'claude-code',
          version: '1.0.0',
          createdAt: '2026-01-01T01:00:00.000Z',
          lastEntryAt: '2026-01-01T01:05:00.000Z',
          archivedAt: '2026-01-02T00:00:00.000Z',
          data: { repositories: ['org/app'] },
        })
        return
      }
      sendJson(res, 404, { error: 'not found' })
    })

    const config = { baseUrl: fixture.baseUrl, token: 't' }
    let exportedPath: string | undefined
    let partitionDir: string | undefined
    try {
      const exported = (await dispatchTool(
        'snapshot_export',
        { dataArrayContains: { repositories: 'org/app' }, inactiveForHours: 8 },
        config,
      )) as SnapshotExportResult
      exportedPath = exported.path
      expect(exported.counts.sessions).toBe(3)
      expect(exported.counts.entries).toBe(4)

      const partitioned = (await dispatchTool(
        'snapshot_partition',
        {
          path: exported.path,
          cleanupToken: exported.cleanupToken,
          maxSessions: 2,
          checksum: exported.checksum.value,
          counts: exported.counts,
        },
        config,
      )) as SnapshotPartitionResult
      partitionDir = partitioned.directory
      expect(partitioned.partitions).toHaveLength(2)

      // Each partition file is valid JSONL preserving session + entry records
      let sessionRecords = 0
      let entryRecords = 0
      for (const part of partitioned.partitions) {
        const lines = (await readFile(part.path, 'utf8')).trim().split('\n')
        for (const line of lines) {
          const parsed = JSON.parse(line) as { type: string }
          if (parsed.type === 'session') sessionRecords += 1
          if (parsed.type === 'entry') entryRecords += 1
        }
      }
      expect(sessionRecords).toBe(3)
      expect(entryRecords).toBe(4)

      // Re-reading session via session_search and archiving works through the same MCP surface
      const searched = (await dispatchTool('session_search', { sessionId: 'sess-1' }, config)) as {
        sessions: Array<{ id: string; lastEntryAt: string | null }>
      }
      expect(searched.sessions[0]?.lastEntryAt).toBe('2026-01-01T01:05:00.000Z')
      await dispatchTool('session_archive', { sessionId: 'sess-1' }, config)
      expect(archivedIds).toEqual(['sess-1'])

      // Cleanup removes both the exported snapshot and the partition directory
      await expect(
        dispatchTool(
          'snapshot_cleanup',
          {
            path: exported.path,
            directory: partitioned.directory,
            cleanupToken: exported.cleanupToken,
          },
          config,
        ),
      ).resolves.toEqual({ removed: true })
      await expect(access(exported.path)).rejects.toThrow()
      await expect(access(partitioned.directory)).rejects.toThrow()
    } finally {
      await fixture.close()
      if (partitionDir) await rm(partitionDir, { recursive: true, force: true })
      if (exportedPath) await rm(exportedPath, { force: true })
    }
  })
})
