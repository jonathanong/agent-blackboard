import { expect, it } from 'vitest'
import { startHttpFixture, sendJson } from '../__tests__/http-fixture.mjs'
import { patchEntry } from './patch.mjs'

it('patches one timestamp-addressed entry', async () => {
  const entry = { sessionId: 's', createdAt: 'now', data: { a: 1 } }
  const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, entry))
  try {
    expect(
      await patchEntry(
        { baseUrl: fixture.baseUrl, token: 't' },
        { sessionId: 's', createdAt: 'now', data: { a: 1 } },
      ),
    ).toEqual(entry)
    expect(fixture.requests[0]).toMatchObject({ method: 'PATCH', url: '/sessions/s/entries' })
    expect(JSON.parse(fixture.requests[0]!.body)).toEqual({ createdAt: 'now', data: { a: 1 } })
  } finally {
    await fixture.close()
  }
})
