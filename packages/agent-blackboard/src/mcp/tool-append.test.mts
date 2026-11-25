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
    expect(
      await handleEntryAppend(
        { sessionId: 's', data: { title: 'x' }, schemaId: 'finding', schemaVersion: 2 },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toEqual(entry)
    expect(JSON.parse(fixture.requests.at(-1)!.body)).toEqual({
      data: { title: 'x' },
      schemaId: 'finding',
      schemaVersion: 2,
    })
    expect(() =>
      handleEntryAppend(
        { sessionId: 's', data: {}, schemaVersion: 1 },
        { baseUrl: 'http://h', token: 't' },
      ),
    ).toThrow(/schemaId/)
    expect(() => handleEntryAppend({ data: {} }, { baseUrl: 'http://h', token: 't' })).toThrow()
    expect(() =>
      handleEntryAppend({ sessionId: 's' }, { baseUrl: 'http://h', token: 't' }),
    ).toThrow()
  } finally {
    await fixture.close()
  }
})
