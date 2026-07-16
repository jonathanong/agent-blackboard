import { describe, expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { dispatchTool } from './dispatch.mjs'

describe('dispatchTool', () => {
  it('routes telemetry_append by name', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, { id: 'a' }))
    try {
      const config = { baseUrl: fixture.baseUrl, token: 't' }
      await dispatchTool('telemetry_append', { data: {}, sessionId: 's1' }, config)
      expect(fixture.requests[0]!.method).toBe('POST')
    } finally {
      await fixture.close()
    }
  })

  it('routes telemetry_get by name', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, []))
    try {
      const result = await dispatchTool(
        'telemetry_get',
        { sessionId: 's1' },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
      expect(result).toEqual({ entries: [] })
    } finally {
      await fixture.close()
    }
  })

  it('routes telemetry_patch by name', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      const result = await dispatchTool(
        'telemetry_patch',
        { patches: [] },
        { baseUrl: fixture.baseUrl, token: 't' },
      )
      expect(result).toEqual({ patched: [] })
    } finally {
      await fixture.close()
    }
  })

  it('throws for an unknown tool name', async () => {
    await expect(
      dispatchTool('telemetry_delete', {}, { baseUrl: 'http://h/', token: 't' }),
    ).rejects.toThrow('Unknown tool: telemetry_delete')
  })
})
