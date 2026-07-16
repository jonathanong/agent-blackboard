import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { patchEntries } from './patch.mjs'
import type { TelemetryEntry } from './types.mjs'

const ENTRY: TelemetryEntry = {
  id: 'a',
  sessionId: 's',
  agent: 'claude-code',
  createdAt: 'now',
  archived: true,
  data: { pr: 7777 },
}

describe('patchEntries', () => {
  it('sends a PATCH with the batch of patches and returns the updated entries', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY]))
    try {
      const result = await patchEntries({ baseUrl: fixture.baseUrl, token: 't' }, [
        { id: 'a', archived: true, data: { pr: 7777 } },
      ])
      expect(result).toEqual([ENTRY])
      const request = fixture.requests[0]!
      expect(request.method).toBe('PATCH')
      expect(JSON.parse(request.body)).toEqual([{ id: 'a', archived: true, data: { pr: 7777 } }])
    } finally {
      await fixture.close()
    }
  })
})
