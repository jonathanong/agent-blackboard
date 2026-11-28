import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { runAppend } from './append.mjs'
import { CliError } from './errors.mjs'
import { runOutbox } from './outbox.mjs'

describe('CLI outbox', () => {
  const dirs: string[] = []
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'abb-cli-outbox-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('queues failed CLI appends and supports status, flush, and prune subcommands', async () => {
    const outboxDir = tempDir()
    const stopped = await startHttpFixture((_req, res) => sendJson(res, 201, {}))
    const deadUrl = stopped.baseUrl
    await stopped.close()

    const appendCtx = createFakeContext({
      env: {
        AGENT_BLACKBOARD_URL: deadUrl,
        AGENT_BLACKBOARD_TOKEN: 't',
        AGENT_BLACKBOARD_OUTBOX_DIR: outboxDir,
      },
    })
    await runAppend(['--session-id', 's1', '{"note":"offline"}'], appendCtx)
    const queued = JSON.parse(appendCtx.stdoutLines[0]!) as { queued: boolean; outboxId: string }
    expect(queued.queued).toBe(true)

    const statusCtx = createFakeContext({ env: {} })
    await runOutbox(['status', '--dir', outboxDir], statusCtx)
    expect(JSON.parse(statusCtx.stdoutLines[0]!)).toMatchObject({
      pending: 1,
      rejected: 0,
      sessions: { s1: { pending: 1, rejected: 0 } },
    })

    // Flush against a server that rejects with 400 -> moves to rejected and still succeeds
    const rejecting = await startHttpFixture((_req, res) =>
      sendJson(res, 400, { code: 'schema_validation_failed', error: 'bad' }),
    )
    try {
      const flushCtx = createFakeContext({
        env: { AGENT_BLACKBOARD_URL: rejecting.baseUrl, AGENT_BLACKBOARD_TOKEN: 't' },
      })
      await runOutbox(['flush', '--session-id', 's1', '--dir', outboxDir], flushCtx)
      expect(JSON.parse(flushCtx.stdoutLines[0]!)).toMatchObject({
        delivered: 0,
        rejected: 1,
        remaining: 0,
      })
    } finally {
      await rejecting.close()
    }

    const pruneCtx = createFakeContext({ env: {} })
    await runOutbox(
      ['prune', '--id', queued.outboxId, '--session-id', 's1', '--dir', outboxDir],
      pruneCtx,
    )
    expect(JSON.parse(pruneCtx.stdoutLines[0]!)).toEqual({
      dir: outboxDir,
      removed: 1,
      remainingRejected: 0,
    })

    const flushAllCtx = createFakeContext({
      env: { AGENT_BLACKBOARD_URL: deadUrl, AGENT_BLACKBOARD_TOKEN: 't' },
    })
    await runOutbox(['flush', '--dir', outboxDir], flushAllCtx)
    expect(JSON.parse(flushAllCtx.stdoutLines[0]!)).toMatchObject({ delivered: 0, remaining: 0 })

    const pruneAllCtx = createFakeContext({ env: {} })
    await runOutbox(['prune', '--dir', outboxDir], pruneAllCtx)
    expect(JSON.parse(pruneAllCtx.stdoutLines[0]!)).toMatchObject({ removed: 0 })
  })

  it('validates outbox CLI arguments', async () => {
    const ctx = createFakeContext({ env: {} })
    await expect(runOutbox([], ctx)).rejects.toThrow(CliError)
    await expect(runOutbox(['unknown'], ctx)).rejects.toThrow(CliError)
    await expect(runOutbox(['status', 'extra'], ctx)).rejects.toThrow(CliError)
    await expect(runOutbox(['status', '--dir'], ctx)).rejects.toThrow(CliError)
    await expect(runOutbox(['status', '--unknown', 'x'], ctx)).rejects.toThrow(/--unknown/)
    await expect(runOutbox(['flush', '--id', 'x'], ctx)).rejects.toThrow(/--id/)
    await expect(runOutbox(['prune', '--bogus'], ctx)).rejects.toThrow(/--bogus/)
    await expect(runOutbox(['extra'], ctx)).rejects.toThrow(CliError)
  })
})
