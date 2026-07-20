import { describe, expect, it } from 'vitest'
import { SessionStoreError } from './errors.mjs'
import { decodeSessionCursor, encodeSessionCursor } from './session-cursor.mjs'

describe('session cursor codec', () => {
  it('round-trips a cursor key', () => {
    const key = { createdAt: '2026-01-01T00:00:00.000Z', sessionId: 's1' }
    expect(decodeSessionCursor(encodeSessionCursor(key))).toEqual(key)
  })

  it('rejects cursors that are not valid base64url/JSON', () => {
    expect(() => decodeSessionCursor('not-base64url-json!!!')).toThrow(SessionStoreError)
    try {
      decodeSessionCursor('not-base64url-json!!!')
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStoreError)
      expect((error as SessionStoreError).code).toBe('invalid_cursor')
    }
  })

  it('rejects cursors whose decoded JSON has the wrong shape', () => {
    const notAnObject = Buffer.from(JSON.stringify('nope'), 'utf8').toString('base64url')
    expect(() => decodeSessionCursor(notAnObject)).toThrow(SessionStoreError)

    const missingSessionId = Buffer.from(
      JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z' }),
      'utf8',
    ).toString('base64url')
    expect(() => decodeSessionCursor(missingSessionId)).toThrow(SessionStoreError)

    const wrongTypes = Buffer.from(JSON.stringify({ createdAt: 1, sessionId: 2 }), 'utf8').toString(
      'base64url',
    )
    expect(() => decodeSessionCursor(wrongTypes)).toThrow(SessionStoreError)

    const nullValue = Buffer.from(JSON.stringify(null), 'utf8').toString('base64url')
    expect(() => decodeSessionCursor(nullValue)).toThrow(SessionStoreError)
  })
})
