import { describe, expect, it } from 'vitest'
import { startHttpFixture, sendJson } from '../__tests__/http-fixture.mjs'
import { Entries } from './entries.mjs'

describe('Entries', () => {
  it('wires append, get, and patch to one client configuration', async () => {
    const entry = { sessionId: 's', createdAt: 'now', data: {} }
    const fixture = await startHttpFixture((req, res) => {
      if (req.method === 'GET') sendJson(res, 200, [entry])
      else sendJson(res, req.method === 'POST' ? 201 : 200, entry)
    })
    try {
      const entries = new Entries({ baseUrl: fixture.baseUrl, token: 't' })
      expect(await entries.append({ sessionId: 's', data: {} })).toEqual(entry)
      const listed = []
      for await (const item of entries.get({ sessionId: 's', format: 'json' })) listed.push(item)
      expect(listed).toEqual([entry])
      expect(await entries.patch({ sessionId: 's', createdAt: 'now', data: { a: 1 } })).toEqual(
        entry,
      )
    } finally {
      await fixture.close()
    }
  })
})
