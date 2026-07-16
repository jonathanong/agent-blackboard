import { describe, expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleTelemetryGet } from './tool-get.mjs'

const ENTRY = {
  id: 'a',
  sessionId: 's1',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: {},
}

describe('handleTelemetryGet', () => {
  it('collects the streamed entries into { entries }', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, [ENTRY]))
    try {
      const result = await handleTelemetryGet(
        { sessionId: 's1' },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
      expect(result).toEqual({ entries: [ENTRY] })
    } finally {
      await fixture.close()
    }
  })

  it('forwards agent/archived/format filters and resolves sessionId when omitted', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      await handleTelemetryGet(
        { agent: 'codex', archived: true, format: 'json' },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(url.searchParams.get('agent')).toBe('codex')
      expect(url.searchParams.get('archived')).toBe('true')
      expect(url.searchParams.get('format')).toBe('json')
      expect(url.searchParams.get('sessionId')).not.toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it('throws for an invalid format', async () => {
    await expect(
      handleTelemetryGet({ format: 'markdown' }, { baseUrl: 'http://h/', token: 't' }),
    ).rejects.toThrow('"format" must be "json" or "jsonl".')
  })
})
