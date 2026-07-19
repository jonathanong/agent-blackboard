import { describe, expect, it } from 'vitest'
import { generateClientToken, parseClientToken } from './tokens.mjs'

describe('generateClientToken', () => {
  it('produces a token that round-trips through parseClientToken', () => {
    const { credId, token } = generateClientToken()
    expect(token.startsWith('abb_sk_')).toBe(true)
    const parsed = parseClientToken(token)
    expect(parsed?.credId).toBe(credId)
    expect(parsed?.secret.length).toBeGreaterThan(0)
  })

  it('generates unique credIds and tokens across calls', () => {
    const a = generateClientToken()
    const b = generateClientToken()
    expect(a.credId).not.toBe(b.credId)
    expect(a.token).not.toBe(b.token)
  })
})

describe('parseClientToken', () => {
  it('rejects tokens without the abb_sk_ prefix', () => {
    expect(parseClientToken('abb_admin_foo_bar')).toBeUndefined()
  })

  it('rejects a token with a truncated credId (no separator at the expected position)', () => {
    expect(parseClientToken('abb_sk_tooshort')).toBeUndefined()
  })

  it('rejects a token with an empty secret', () => {
    const credId = 'A'.repeat(22)
    expect(parseClientToken(`abb_sk_${credId}_`)).toBeUndefined()
  })

  it('accepts a credId containing underscores as long as length + separator line up', () => {
    const credId = `${'A'.repeat(21)}_`
    const token = `abb_sk_${credId}_somesecret`
    expect(parseClientToken(token)).toEqual({ credId, secret: 'somesecret' })
  })
})
