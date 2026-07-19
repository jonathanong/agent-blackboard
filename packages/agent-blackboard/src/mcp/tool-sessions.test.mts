import { expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { handleSessionArchive, handleSessionCreate } from './tool-sessions.mjs'

it('creates roots/children and archives explicit sessions', async () => {
  const session = { id: 's', parentSessionId: null, createdAt: 'now', archivedAt: null }
  const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, session))
  try {
    const config = { baseUrl: fixture.baseUrl, token: 't' }
    expect(await handleSessionCreate({ sessionId: 's', parentSessionId: null }, config)).toEqual(
      session,
    )
    expect(await handleSessionArchive({ sessionId: 's' }, config)).toEqual(session)
    expect(() => handleSessionCreate({ sessionId: 's' }, config)).toThrow()
  } finally {
    await fixture.close()
  }
})
