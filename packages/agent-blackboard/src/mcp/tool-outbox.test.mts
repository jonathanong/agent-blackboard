import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleEntryAppend } from './tool-append.mjs'
import { handleOutboxFlush, handleOutboxPruneRejected, handleOutboxStatus } from './tool-outbox.mjs'

describe('MCP outbox tools', () => {
  const dirs: string[] = []
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'abb-mcp-outbox-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('queues unreachable MCP entry_append and exposes status, flush, and prune tools', async () => {
    const worktree = tempDir()
    const outboxDir = join(worktree, 'outbox')
    const stopped = await startHttpFixture((_req, res) => sendJson(res, 201, {}))
    const deadUrl = stopped.baseUrl
    await stopped.close()

    const resolution = { cwd: worktree, env: { AGENT_BLACKBOARD_OUTBOX_DIR: outboxDir } }
    const queued = await handleEntryAppend(
      { sessionId: 's1', data: { note: 'mcp offline' } },
      { baseUrl: deadUrl, token: 't' },
      resolution,
    )
    expect(queued.queued).toBe(true)
    if (!queued.queued) throw new Error('expected queued')

    const status = await handleOutboxStatus({}, { baseUrl: deadUrl, token: 't' }, resolution)
    expect(status).toMatchObject({ dir: outboxDir, pending: 1, rejected: 0 })

    // Server returns 400 on flush -> moved to rejected
    const rejecting = await startHttpFixture((_req, res) =>
      sendJson(res, 400, { code: 'schema_required', error: 'schema required' }),
    )
    try {
      const flushed = await handleOutboxFlush(
        { sessionId: 's1', dir: outboxDir },
        { baseUrl: rejecting.baseUrl, token: 't' },
      )
      expect(flushed).toEqual({
        dir: outboxDir,
        delivered: 0,
        duplicates: 0,
        rejected: 1,
        remaining: 0,
      })

      const pruned = await handleOutboxPruneRejected(
        { id: queued.outboxId, sessionId: 's1', dir: outboxDir },
        { baseUrl: rejecting.baseUrl, token: 't' },
      )
      expect(pruned).toEqual({ dir: outboxDir, removed: 1, remainingRejected: 0 })

      const defaultPrune = await handleOutboxPruneRejected(
        {},
        { baseUrl: rejecting.baseUrl, token: 't' },
        resolution,
      )
      expect(defaultPrune).toEqual({ dir: outboxDir, removed: 0, remainingRejected: 0 })

      const defaultFlush = await handleOutboxFlush(
        {},
        { baseUrl: rejecting.baseUrl, token: 't' },
        resolution,
      )
      expect(defaultFlush).toEqual({
        dir: outboxDir,
        delivered: 0,
        duplicates: 0,
        rejected: 0,
        remaining: 0,
      })
    } finally {
      await rejecting.close()
    }
  })
})
