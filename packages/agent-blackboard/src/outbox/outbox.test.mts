import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { Entries } from '../client/entries.mjs'
import { AgentBlackboardError } from '../client/errors.mjs'
import { isPermanentRejection, isRetryableAppendError } from './classify.mjs'
import { Outbox } from './client.mjs'
import {
  DEFAULT_OUTBOX_RELATIVE,
  enqueueOutboxEntry,
  movePendingToRejected,
  resolveOutboxDir,
  updatePendingError,
} from './store.mjs'

describe('client entry outbox', () => {
  const dirs: string[] = []
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'abb-outbox-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('resolves outbox directory from explicit path, env var, or enclosing worktree', () => {
    const root = tempDir()
    expect(resolveOutboxDir(root, {}, 'custom/outbox')).toBe(join(root, 'custom/outbox'))
    expect(resolveOutboxDir(root, { AGENT_BLACKBOARD_OUTBOX_DIR: 'env-outbox' })).toBe(
      join(root, 'env-outbox'),
    )
    expect(resolveOutboxDir(root, {})).toBe(join(root, DEFAULT_OUTBOX_RELATIVE))
  })

  it('classifies retryable vs permanent append failures', () => {
    expect(isRetryableAppendError(new TypeError('fetch failed'))).toBe(true)
    expect(isRetryableAppendError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isRetryableAppendError(new DOMException('timed out', 'TimeoutError'))).toBe(true)
    expect(
      isRetryableAppendError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })),
    ).toBe(true)
    expect(
      isRetryableAppendError(Object.assign(new Error('undici'), { code: 'UND_ERR_SOCKET' })),
    ).toBe(true)
    expect(
      isRetryableAppendError(
        new TypeError('socket error', {
          cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        }),
      ),
    ).toBe(true)
    expect(
      isRetryableAppendError(
        new TypeError('baseUrl must use HTTPS; HTTP is allowed only for local loopback servers'),
      ),
    ).toBe(false)
    expect(isRetryableAppendError(new RangeError('bad'))).toBe(false)
    expect(isRetryableAppendError('not-an-error')).toBe(false)
    expect(isRetryableAppendError(new AgentBlackboardError('unauth', 401, {}))).toBe(true)
    expect(isRetryableAppendError(new AgentBlackboardError('timeout', 408, {}))).toBe(true)
    expect(isRetryableAppendError(new AgentBlackboardError('rate', 429, {}))).toBe(true)
    expect(isRetryableAppendError(new AgentBlackboardError('down', 503, {}))).toBe(true)
    expect(isRetryableAppendError(new AgentBlackboardError('bad', 400, {}))).toBe(false)
    expect(isPermanentRejection(new AgentBlackboardError('bad', 400, {}))).toBe(true)
    expect(isPermanentRejection(new AgentBlackboardError('unauth', 401, {}))).toBe(false)
    expect(isPermanentRejection(new TypeError('fetch failed'))).toBe(false)
  })

  it('queues failed appends while server is stopped, then flushes cleanly when server restarts', async () => {
    const outboxDir = tempDir()
    // Start a server and immediately stop it to get a guaranteed unreachable localhost URL
    const stopped = await startHttpFixture((_req, res) => sendJson(res, 201, {}))
    const deadUrl = stopped.baseUrl
    await stopped.close()

    const offlineEntries = new Entries({ baseUrl: deadUrl, token: 't', outboxDir })
    const queued = await offlineEntries.append({
      sessionId: 's1',
      data: { note: 'offline finding' },
      schemaId: 'finding',
      schemaVersion: 1,
    })
    expect(queued.queued).toBe(true)
    if (!queued.queued) throw new Error('expected queued result')
    expect(queued.sessionId).toBe('s1')
    expect(queued.schemaId).toBe('finding')
    expect(queued.schemaVersion).toBe(1)
    expect(queued.sourceEventId).toMatch(/^outbox-/)
    expect(queued.error.length).toBeGreaterThan(0)

    // Permanent 400 errors on direct append are NOT silently queued
    const rejecting = await startHttpFixture((_req, res) =>
      sendJson(res, 400, { code: 'schema_validation_failed', error: 'missing title' }),
    )
    try {
      await expect(
        new Entries({ baseUrl: rejecting.baseUrl, token: 't', outboxDir }).append({
          sessionId: 's1',
          data: {},
        }),
      ).rejects.toMatchObject({ status: 400 })
    } finally {
      await rejecting.close()
    }

    // Status reflects 1 pending entry for s1
    const offlineOutbox = new Outbox({ baseUrl: deadUrl, token: 't', outboxDir })
    expect(offlineOutbox.status()).toMatchObject({
      dir: outboxDir,
      pending: 1,
      rejected: 0,
      sessions: { s1: { pending: 1, rejected: 0 } },
      rejectedRecords: [],
    })

    // Restart server and flush: entry is stored exactly once
    const stored: Array<Record<string, unknown>> = []
    const restarted = await startHttpFixture((req, res) => {
      const body = JSON.parse(req.body) as Record<string, unknown>
      const existing = stored.find((e) => e.sourceEventId === body.sourceEventId)
      if (existing) {
        sendJson(res, 200, { ...existing, duplicate: true })
        return
      }
      const created = {
        sessionId: 's1',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...body,
      }
      stored.push(created)
      sendJson(res, 201, created)
    })
    try {
      const onlineOutbox = new Outbox({ baseUrl: restarted.baseUrl, token: 't', outboxDir })
      expect(await onlineOutbox.flush()).toEqual({
        dir: outboxDir,
        delivered: 1,
        duplicates: 0,
        rejected: 0,
        remaining: 0,
      })
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        sessionId: 's1',
        data: { note: 'offline finding' },
        schemaId: 'finding',
        schemaVersion: 1,
        sourceEventId: queued.sourceEventId,
      })
      expect(onlineOutbox.status()).toEqual({
        dir: outboxDir,
        pending: 0,
        rejected: 0,
        sessions: {},
        rejectedRecords: [],
      })

      // Flushing a queued entry that the server already accepted counts as delivered + duplicate
      enqueueOutboxEntry(
        outboxDir,
        { sessionId: 's1', data: { note: 'offline finding' }, sourceEventId: queued.sourceEventId },
        'timeout',
      )
      expect(await onlineOutbox.flush({ sessionId: 's1' })).toEqual({
        dir: outboxDir,
        delivered: 1,
        duplicates: 1,
        rejected: 0,
        remaining: 0,
      })
      expect(stored).toHaveLength(1)
    } finally {
      await restarted.close()
    }
  })

  it('moves 400 rejections aside without blocking valid entries, keeps retryable failures pending, and prunes rejected', async () => {
    const outboxDir = tempDir()
    let t = Date.parse('2026-01-01T00:00:00.000Z')
    const tick = () => new Date((t += 1000))

    const badRec = enqueueOutboxEntry(
      outboxDir,
      { sessionId: 's1', data: { bad: true }, sourceEventId: 'evt-bad' },
      'initial',
      tick,
    )
    enqueueOutboxEntry(
      outboxDir,
      { sessionId: 's2', data: { ok: true }, sourceEventId: 'evt-ok' },
      'initial',
      tick,
    )
    enqueueOutboxEntry(
      outboxDir,
      { sessionId: 's2', data: { later: true }, sourceEventId: 'evt-503' },
      'initial',
      tick,
    )

    const fixture = await startHttpFixture((req, res) => {
      const body = JSON.parse(req.body) as { sourceEventId?: string }
      if (body.sourceEventId === 'evt-bad') {
        sendJson(res, 400, { code: 'schema_validation_failed', error: 'invalid payload' })
        return
      }
      if (body.sourceEventId === 'evt-503') {
        sendJson(res, 503, { error: 'unavailable' })
        return
      }
      sendJson(res, 201, { sessionId: 's2', createdAt: 'now', data: { ok: true } })
    })
    try {
      const outbox = new Outbox({ baseUrl: fixture.baseUrl, token: 't', outboxDir })
      const flushed = await outbox.flush()
      expect(flushed).toEqual({
        dir: outboxDir,
        delivered: 1,
        duplicates: 0,
        rejected: 1,
        remaining: 1,
      })

      const status = outbox.status()
      expect(status.pending).toBe(1)
      expect(status.rejected).toBe(1)
      expect(status.sessions).toEqual({
        s1: { pending: 0, rejected: 1 },
        s2: { pending: 1, rejected: 0 },
      })
      expect(status.rejectedRecords[0]).toMatchObject({
        id: badRec.id,
        sessionId: 's1',
        status: 400,
        errorBody: { code: 'schema_validation_failed', error: 'invalid payload' },
      })

      // Add a second rejected record on s2 directly to verify both counts on one session and filtered prune
      const second = enqueueOutboxEntry(outboxDir, { sessionId: 's2', data: { bad2: true } }, 'e')
      movePendingToRejected(outboxDir, 'nonexistent.json', second, { error: 'bad' })
      expect(outbox.status().sessions.s2).toEqual({ pending: 2, rejected: 1 })

      expect(outbox.pruneRejected({ sessionId: 's1', id: badRec.id })).toEqual({
        dir: outboxDir,
        removed: 1,
        remainingRejected: 1,
      })
      expect(outbox.pruneRejected()).toEqual({
        dir: outboxDir,
        removed: 1,
        remainingRejected: 0,
      })
    } finally {
      await fixture.close()
    }
  })

  it('cleans up temp file if atomic write fails and resolves default cwd when dir is omitted', () => {
    const dir = tempDir()
    const outbox = new Outbox({ baseUrl: 'http://localhost:1', token: 't' })
    expect(outbox.status({ cwd: dir }).dir).toBe(join(dir, DEFAULT_OUTBOX_RELATIVE))
    expect(outbox.status({ dir }).pending).toBe(0)
    const collidingDir = join(dir, 'pending', 'existing-dir.json')
    mkdirSync(collidingDir, { recursive: true })
    const rec = enqueueOutboxEntry(dir, { sessionId: 's', data: {} }, 'e')
    expect(() => updatePendingError(dir, 'existing-dir.json', rec, 'boom')).toThrow()
    expect(readdirSync(join(dir, 'pending')).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('binds sourceEventId and snapshots data before the first POST, deduplicating lost responses', async () => {
    const outboxDir = tempDir()
    const stored: Array<Record<string, unknown>> = []
    let dropFirstResponse = true
    const fixture = await startHttpFixture((req, res) => {
      const body = JSON.parse(req.body) as Record<string, unknown>
      const existing = stored.find((e) => e.sourceEventId === body.sourceEventId)
      if (existing) {
        sendJson(res, 200, { ...existing, duplicate: true })
        return
      }
      const created = { sessionId: 's1', createdAt: '2026-01-01T00:00:00.000Z', ...body }
      stored.push(created)
      if (dropFirstResponse) {
        dropFirstResponse = false
        // Server committed the write, then connection dropped before the client got a response
        res.socket?.destroy()
        return
      }
      sendJson(res, 201, created)
    })
    try {
      const entries = new Entries({ baseUrl: fixture.baseUrl, token: 't', outboxDir })
      const mutableData = { note: 'original' }
      const pendingPromise = entries.append({ sessionId: 's1', data: mutableData })
      // Mutate caller's object synchronously while the POST is in flight
      mutableData.note = 'mutated-after-call'
      const queued = await pendingPromise
      expect(queued.queued).toBe(true)
      if (!queued.queued) throw new Error('expected queued result')
      expect(queued.data).toEqual({ note: 'original' })
      expect(queued.sourceEventId).toBe(stored[0]!.sourceEventId)

      const outbox = new Outbox({ baseUrl: fixture.baseUrl, token: 't', outboxDir })
      expect(await outbox.flush()).toEqual({
        dir: outboxDir,
        delivered: 1,
        duplicates: 1,
        rejected: 0,
        remaining: 0,
      })
      expect(stored).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })

  it('does not queue configuration errors, rethrows non-ENOENT dir errors, and isolates corrupt files', async () => {
    const outboxDir = tempDir()
    // Non-HTTPS remote URL must throw immediately instead of queuing
    await expect(
      new Entries({ baseUrl: 'http://example.com', token: 't', outboxDir }).append({
        sessionId: 's1',
        data: { note: 'bad-url' },
      }),
    ).rejects.toThrow(/HTTPS/)
    const outbox = new Outbox({ baseUrl: 'http://localhost:1', token: 't', outboxDir })
    expect(outbox.status().pending).toBe(0)

    // Non-ENOENT directory error (e.g. pending is a file -> ENOTDIR) propagates
    const brokenRoot = tempDir()
    writeFileSync(join(brokenRoot, 'pending'), 'not-a-dir')
    expect(() =>
      new Outbox({ baseUrl: 'http://localhost:1', token: 't', outboxDir: brokenRoot }).status(),
    ).toThrow()

    // Corrupt / malformed JSON files are reported without blocking valid records
    const valid = enqueueOutboxEntry(outboxDir, { sessionId: 's1', data: { ok: 1 } }, 'net')
    const corruptPending = join(outboxDir, 'pending', '0000-corrupt.json')
    const malformedPending = join(outboxDir, 'pending', '0001-malformed.json')
    writeFileSync(corruptPending, '{truncated')
    writeFileSync(malformedPending, JSON.stringify({ id: 'x' }))
    mkdirSync(join(outboxDir, 'rejected'), { recursive: true })
    const corruptRejected = join(outboxDir, 'rejected', '0000-bad-rejected.json')
    writeFileSync(corruptRejected, JSON.stringify({ ...valid }))

    const status = outbox.status()
    expect(status.pending).toBe(1)
    expect(status.rejected).toBe(0)
    expect(status.corruptFiles).toEqual([corruptPending, malformedPending, corruptRejected])
  })
})
