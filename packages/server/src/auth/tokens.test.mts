import { describe, expect, it } from 'vitest'
import { generateJournalingToken, parseJournalingToken } from './tokens.mjs'

describe('generateJournalingToken', () => {
  it('produces a token that round-trips through parseJournalingToken', () => {
    const { credId, token } = generateJournalingToken()
    expect(token.startsWith('ag_sk_')).toBe(true)
    const parsed = parseJournalingToken(token)
    expect(parsed?.credId).toBe(credId)
    expect(parsed?.secret.length).toBeGreaterThan(0)
  })

  it('generates unique credIds and tokens across calls', () => {
    const a = generateJournalingToken()
    const b = generateJournalingToken()
    expect(a.credId).not.toBe(b.credId)
    expect(a.token).not.toBe(b.token)
  })
})

describe('parseJournalingToken', () => {
  it('rejects tokens without the ag_sk_ prefix', () => {
    expect(parseJournalingToken('ag_admin_foo_bar')).toBeUndefined()
  })

  it('rejects a token with a truncated credId (no separator at the expected position)', () => {
    expect(parseJournalingToken('ag_sk_tooshort')).toBeUndefined()
  })

  it('rejects a token with an empty secret', () => {
    const credId = 'A'.repeat(22)
    expect(parseJournalingToken(`ag_sk_${credId}_`)).toBeUndefined()
  })

  it('accepts a credId containing underscores as long as length + separator line up', () => {
    const credId = `${'A'.repeat(21)}_`
    const token = `ag_sk_${credId}_somesecret`
    expect(parseJournalingToken(token)).toEqual({ credId, secret: 'somesecret' })
  })
})
