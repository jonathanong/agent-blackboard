import { describe, expect, it } from 'vitest'
import { startHttpFixture, sendJson } from '../__tests__/http-fixture.mjs'
import { appendEntry } from './append.mjs'

describe('appendEntry', () => {
  it('posts data to an encoded explicit session and returns one entry', async () => {
    const entry = { sessionId: 's/1', createdAt: 'now', data: { a: 1 } }
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 201, entry))
    try {
      expect(
        await appendEntry(
          { baseUrl: fixture.baseUrl, token: 't' },
          { sessionId: 's/1', data: { a: 1 } },
        ),
      ).toEqual(entry)
      expect(fixture.requests[0]).toMatchObject({
        method: 'POST',
        url: '/sessions/s%2F1/entries',
      })
      expect(JSON.parse(fixture.requests[0]!.body)).toEqual({ data: { a: 1 } })
    } finally {
      await fixture.close()
    }
  })
})
