import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleEntryPatch } from './tool-patch.mjs'

it('requires a composite key and patches one entry', async () => {
  const entry = { sessionId: 's', createdAt: 'now', data: { a: 1 } }
  const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, entry))
  try {
    expect(
      await handleEntryPatch(
        { sessionId: 's', createdAt: 'now', data: { a: 1 } },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toEqual(entry)
    expect(() =>
      handleEntryPatch({ sessionId: 's', data: {} }, { baseUrl: 'http://h', token: 't' }),
    ).toThrow()
  } finally {
    await fixture.close()
  }
})
