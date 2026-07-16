import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from './__tests__/http-fixture.mjs'
import { AtelError, Auth, resolveSessionId, Telemetries, Telemetry } from './index.mjs'

describe('public API surface', () => {
  it('exports Telemetry, Telemetries, Auth, AtelError, and resolveSessionId wired to the same client', async () => {
    const created = {
      id: 'a',
      sessionId: 's1',
      agent: 'claude-code',
      createdAt: 'now',
      archived: false,
      data: { note: 'hi' },
    }
    const fixture = await startHttpFixture((req, res) => {
      if (req.url.startsWith('/credentials')) {
        sendJson(res, 401, { message: 'admin only' })
        return
      }
      sendJson(res, 200, created)
    })
    try {
      const telemetry = new Telemetry({
        baseUrl: fixture.baseUrl,
        token: 't',
        sessionId: resolveSessionId('s1'),
      })
      expect(await telemetry.append({ note: 'hi' })).toEqual(created)

      const telemetries = new Telemetries({ baseUrl: fixture.baseUrl, token: 't' })
      expect(
        await telemetries.append({ sessionId: 's1', agent: 'claude-code', data: { note: 'hi' } }),
      ).toEqual(created)

      const auth = new Auth({ baseUrl: fixture.baseUrl, adminToken: 'admin' })
      await expect(auth.listCredentials()).rejects.toBeInstanceOf(AtelError)
    } finally {
      await fixture.close()
    }
  })
})
