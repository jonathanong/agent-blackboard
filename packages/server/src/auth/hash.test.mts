import { describe, expect, it } from 'vitest'
import { hashToken } from './hash.mjs'

describe('hashToken', () => {
  it('returns a stable sha256 hex digest', () => {
    expect(hashToken('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('produces different digests for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})
