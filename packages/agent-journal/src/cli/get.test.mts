import { describe, expect, it } from 'vitest'
import { createFakeContext } from '../__tests__/cli-context.mjs'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { CliError } from './errors.mjs'
import { runGet } from './get.mjs'

const ENV = (baseUrl: string) => ({ AGENT_JOURNAL_URL: baseUrl, AGENT_JOURNAL_TOKEN: 't' })

describe('runGet', () => {
  it('defaults to format json, filtered to the resolved session', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [{ id: 'a' }]))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--session-id', 's1'], ctx)
      const request = fixture.requests[0]!
      expect(request.headers.accept).toBe('application/json')
      const url = new URL(request.url, fixture.baseUrl)
      expect(url.searchParams.get('sessionId')).toBe('s1')
      expect(url.searchParams.get('format')).toBe('json')
      expect(ctx.stdoutLines.join('')).toBe(JSON.stringify([{ id: 'a' }]))
    } finally {
      await fixture.close()
    }
  })

  it('omits the sessionId filter when --all-sessions is given', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--all-sessions'], ctx)
      expect(
        new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('sessionId'),
      ).toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it('streams multiple chunks to stdout as they arrive for --format jsonl', async () => {
    const fixture = await startHttpFixture((_req, res) =>
      sendNdjson(res, [{ id: 'a' }, { id: 'b' }]),
    )
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--session-id', 's1', '--format', 'jsonl'], ctx)
      expect(fixture.requests[0]!.headers.accept).toBe('application/x-ndjson')
      expect(ctx.stdoutLines.length).toBeGreaterThanOrEqual(2)
      expect(ctx.stdoutLines.join('')).toBe('{"id":"a"}\n{"id":"b"}\n')
    } finally {
      await fixture.close()
    }
  })

  it('requests markdown when --format markdown is given', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/markdown' })
      res.end('# Journal\n')
    })
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--session-id', 's1', '--format', 'markdown'], ctx)
      expect(fixture.requests[0]!.headers.accept).toBe('text/markdown')
      expect(ctx.stdoutLines.join('')).toBe('# Journal\n')
    } finally {
      await fixture.close()
    }
  })

  it('forwards --agent and --archived', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--session-id', 's1', '--agent', 'codex', '--archived', 'true'], ctx)
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(url.searchParams.get('agent')).toBe('codex')
      expect(url.searchParams.get('archived')).toBe('true')
    } finally {
      await fixture.close()
    }
  })

  it('writes nothing when the response has no body (e.g. 204)', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(204)
      res.end()
    })
    try {
      const ctx = createFakeContext({ env: ENV(fixture.baseUrl) })
      await runGet(['--session-id', 's1'], ctx)
      expect(ctx.stdoutLines).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  it('throws CliError for an invalid --format', async () => {
    const ctx = createFakeContext({ env: ENV('http://h/') })
    await expect(runGet(['--format', 'yaml'], ctx)).rejects.toThrow(CliError)
  })
})
