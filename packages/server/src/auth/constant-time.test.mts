import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from './constant-time.mjs'

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true)
  })

  it('returns false for different strings of equal length', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false)
  })

  it('returns false (not throws) for different-length strings', () => {
    expect(constantTimeEqual('short', 'a much longer string')).toBe(false)
  })

  it('returns false for empty vs non-empty', () => {
    expect(constantTimeEqual('', 'x')).toBe(false)
  })
})
