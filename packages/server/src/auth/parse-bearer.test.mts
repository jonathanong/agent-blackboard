import { describe, expect, it } from 'vitest'
import { parseBearerToken } from './parse-bearer.mjs'

describe('parseBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearerToken('Bearer abc.123')).toBe('abc.123')
  })

  it('is case-insensitive on the scheme', () => {
    expect(parseBearerToken('bearer abc.123')).toBe('abc.123')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseBearerToken('  Bearer abc.123  ')).toBe('abc.123')
  })

  it('returns undefined for undefined header', () => {
    expect(parseBearerToken(undefined)).toBeUndefined()
  })

  it('returns undefined for an empty header', () => {
    expect(parseBearerToken('')).toBeUndefined()
  })

  it('returns undefined for a non-Bearer scheme', () => {
    expect(parseBearerToken('Basic abc.123')).toBeUndefined()
  })

  it('returns undefined for a Bearer header with no token', () => {
    expect(parseBearerToken('Bearer')).toBeUndefined()
  })
})
