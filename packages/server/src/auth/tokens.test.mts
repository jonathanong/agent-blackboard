import { describe, expect, it } from 'vitest'
import { generateTelemetryToken, parseTelemetryToken } from './tokens.mjs'

describe('generateTelemetryToken', () => {
  it('produces a token that round-trips through parseTelemetryToken', () => {
    const { credId, token } = generateTelemetryToken()
    expect(token.startsWith('atl_sk_')).toBe(true)
    const parsed = parseTelemetryToken(token)
    expect(parsed?.credId).toBe(credId)
    expect(parsed?.secret.length).toBeGreaterThan(0)
  })

  it('generates unique credIds and tokens across calls', () => {
    const a = generateTelemetryToken()
    const b = generateTelemetryToken()
    expect(a.credId).not.toBe(b.credId)
    expect(a.token).not.toBe(b.token)
  })
})

describe('parseTelemetryToken', () => {
  it('rejects tokens without the atl_sk_ prefix', () => {
    expect(parseTelemetryToken('atl_admin_foo_bar')).toBeUndefined()
  })

  it('rejects a token with a truncated credId (no separator at the expected position)', () => {
    expect(parseTelemetryToken('atl_sk_tooshort')).toBeUndefined()
  })

  it('rejects a token with an empty secret', () => {
    const credId = 'A'.repeat(22)
    expect(parseTelemetryToken(`atl_sk_${credId}_`)).toBeUndefined()
  })

  it('accepts a credId containing underscores as long as length + separator line up', () => {
    const credId = `${'A'.repeat(21)}_`
    const token = `atl_sk_${credId}_somesecret`
    expect(parseTelemetryToken(token)).toEqual({ credId, secret: 'somesecret' })
  })
})
