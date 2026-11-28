import { access, readFile } from 'node:fs/promises'
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

interface DistillFollowUp {
  rootCause: string
  sessions: string[]
  evidence: Array<{ sessionId: string; createdAt: string; summary: string }>
}

interface SnapshotSessionRecord {
  type: 'session'
  session: {
    id: string
    createdAt: string
    lastEntryAt: string | null
    data: { repositories?: string[] }
  }
}

interface SnapshotEntryRecord {
  type: 'entry'
  entry: {
    sessionId: string
    createdAt: string
    data: {
      repositories?: string[]
      rootCause: string
      summary: string
      severity: 'high' | 'medium' | 'low'
    }
  }
}

async function runDistillWorkflow(options: {
  config: { baseUrl: string; token: string }
  repository: string
  inactiveForHours: number
  archive: boolean
}): Promise<{
  followUps: DistillFollowUp[]
  archivedSessions: string[]
  exportedPath: string
  partitionDir: string
}> {
  const exported = (await dispatchTool(
    'snapshot_export',
    {
      dataArrayContains: { repositories: options.repository },
      inactiveForHours: options.inactiveForHours,
    },
    options.config,
  )) as SnapshotExportResult
  let partitionDir = ''
  try {
    const partitioned = (await dispatchTool(
      'snapshot_partition',
      {
        path: exported.path,
        cleanupToken: exported.cleanupToken,
        maxSessions: 2,
        checksum: exported.checksum.value,
        counts: exported.counts,
      },
      options.config,
    )) as SnapshotPartitionResult
    partitionDir = partitioned.directory

    const sessions = new Map<string, SnapshotSessionRecord['session']>()
    const groups = new Map<
      string,
      {
        sessions: Set<string>
        hasHighSeverity: boolean
        evidence: Array<{ sessionId: string; createdAt: string; summary: string }>
      }
    >()

    for (const partition of partitioned.partitions) {
      const lines = (await readFile(partition.path, 'utf8')).trim().split('\n')
      for (const line of lines) {
        const record = JSON.parse(line) as
          | SnapshotSessionRecord
          | SnapshotEntryRecord
          | { type: 'manifest' }
        if (record.type === 'session') {
          sessions.set(record.session.id, record.session)
        } else if (record.type === 'entry') {
          const repos = record.entry.data.repositories ?? []
          if (!repos.includes(options.repository)) continue
          const key = record.entry.data.rootCause
          const group = groups.get(key) ?? {
            sessions: new Set<string>(),
            hasHighSeverity: false,
            evidence: [],
          }
          group.sessions.add(record.entry.sessionId)
          if (record.entry.data.severity === 'high') group.hasHighSeverity = true
          group.evidence.push({
            sessionId: record.entry.sessionId,
            createdAt: record.entry.createdAt,
            summary: record.entry.data.summary,
          })
          groups.set(key, group)
        }
      }
    }

    const followUps: DistillFollowUp[] = []
    for (const [rootCause, group] of groups) {
      if (group.sessions.size >= 2 || group.hasHighSeverity) {
        followUps.push({
          rootCause,
          sessions: [...group.sessions].sort(),
          evidence: group.evidence,
        })
      }
    }

    const archivedSessions: string[] = []
    if (options.archive) {
      for (const session of sessions.values()) {
        const repos = session.data.repositories ?? []
        if (repos.length === 1 && repos[0] === options.repository) {
          await dispatchTool('session_archive', { sessionId: session.id }, options.config)
          archivedSessions.push(session.id)
        }
      }
    }

    return { followUps, archivedSessions, exportedPath: exported.path, partitionDir }
  } finally {
    await dispatchTool(
      'snapshot_cleanup',
      {
        path: exported.path,
        ...(partitionDir ? { directory: partitionDir } : {}),
        cleanupToken: exported.cleanupToken,
      },
      options.config,
    )
  }
}

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
      'session_archive',
    ]) {
      expect(mcpToolNames.has(toolName)).toBe(true)
      expect(skillText).toContain(toolName)
    }
  })

  it('distills a recorded snapshot into expected follow-ups, archives only when asked, and leaves no snapshot files', async () => {
    const recordedSnapshot = await readFile(fileURLToPath(FIXTURE_PATH), 'utf8')
    const archivedIds: string[] = []
    const fixture = await startHttpFixture((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/snapshot') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.end(recordedSnapshot)
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
          data: {},
        })
        return
      }
      sendJson(res, 404, { error: 'not found' })
    })

    const config = { baseUrl: fixture.baseUrl, token: 't' }
    try {
      // Read-only run: returns recurring + high-severity follow-ups, archives nothing, cleans up files
      const dryRun = await runDistillWorkflow({
        config,
        repository: 'org/app',
        inactiveForHours: 8,
        archive: false,
      })
      expect(dryRun.followUps).toEqual([
        {
          rootCause: 'missing-lockfile-check',
          sessions: ['sess-1', 'sess-2'],
          evidence: [
            {
              sessionId: 'sess-1',
              createdAt: '2026-01-01T01:05:00.000Z',
              summary: 'CI failed because pnpm-lock.yaml drifted',
            },
            {
              sessionId: 'sess-2',
              createdAt: '2026-01-01T02:05:00.000Z',
              summary: 'Second agent hit stale lockfile in CI',
            },
          ],
        },
        {
          rootCause: 'unredacted-secret-log',
          sessions: ['sess-3'],
          evidence: [
            {
              sessionId: 'sess-3',
              createdAt: '2026-01-01T03:05:00.000Z',
              summary: 'Error handler logged raw bearer header',
            },
          ],
        },
      ])
      expect(dryRun.archivedSessions).toEqual([])
      expect(archivedIds).toEqual([])
      await expect(access(dryRun.exportedPath)).rejects.toThrow()
      await expect(access(dryRun.partitionDir)).rejects.toThrow()

      // Archiving run: archives single-repo sessions only (leaves multi-repo sess-3 active) and cleans up
      const archivingRun = await runDistillWorkflow({
        config,
        repository: 'org/app',
        inactiveForHours: 8,
        archive: true,
      })
      expect(archivingRun.archivedSessions).toEqual(['sess-1', 'sess-2'])
      expect(archivedIds).toEqual(['sess-1', 'sess-2'])
      await expect(access(archivingRun.exportedPath)).rejects.toThrow()
      await expect(access(archivingRun.partitionDir)).rejects.toThrow()
    } finally {
      await fixture.close()
    }
  })
})
