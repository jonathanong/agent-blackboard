import { expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleEntryGet } from './tool-get.mjs'

it('requires a session id and collects entries', async () => {
  const entry = { sessionId: 's', createdAt: 'now', data: {} }
  const fixture = await startHttpFixture((req, res) =>
    req.url.includes('format=json') && !req.url.includes('format=jsonl')
      ? sendJson(res, 200, [entry])
      : sendNdjson(res, [entry]),
  )
  try {
    expect(
      await handleEntryGet(
        { sessionId: 's', format: 'json' },
        { baseUrl: fixture.baseUrl, token: 't' },
      ),
    ).toEqual({ entries: [entry] })
    expect(
      await handleEntryGet({ sessionId: 's' }, { baseUrl: fixture.baseUrl, token: 't' }),
    ).toEqual({ entries: [entry] })
    await expect(handleEntryGet({}, { baseUrl: fixture.baseUrl, token: 't' })).rejects.toThrow()
  } finally {
    await fixture.close()
  }
})
