import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleEntryAppend } from './tool-append.mjs'

it('requires sessionId/data and appends one entry', async () => {
  const entry = { sessionId: 's', createdAt: 'now', data: {} }
  const fixture = await startHttpFixture((_req, res) => sendJson(res, 201, entry))
  try {
    expect(
      await handleEntryAppend(
        { sessionId: 's', data: {} },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toEqual(entry)
    expect(() => handleEntryAppend({ data: {} }, { baseUrl: 'http://h', token: 't' })).toThrow()
    expect(() =>
      handleEntryAppend({ sessionId: 's' }, { baseUrl: 'http://h', token: 't' }),
    ).toThrow()
  } finally {
    await fixture.close()
  }
})
