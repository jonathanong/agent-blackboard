import { describe, expect, it } from 'vitest'
import { formatSchemaRef, isValidSchemaId, parseSchemaRef, parseSchemaVersion } from './id.mjs'

describe('schema id and ref helpers', () => {
  it('accepts valid schema ids and rejects unsafe or oversized ids', () => {
    expect(isValidSchemaId('finding')).toBe(true)
    expect(isValidSchemaId('Agent.Finding_v1-beta')).toBe(true)
    expect(isValidSchemaId('a'.repeat(128))).toBe(true)

    expect(isValidSchemaId('')).toBe(false)
    expect(isValidSchemaId('a'.repeat(129))).toBe(false)
    expect(isValidSchemaId('.hidden')).toBe(false)
    expect(isValidSchemaId('-leading-dash')).toBe(false)
    expect(isValidSchemaId('foo..bar')).toBe(false)
    expect(isValidSchemaId('foo/bar')).toBe(false)
    expect(isValidSchemaId('http:foo')).toBe(false)
    expect(isValidSchemaId('foo@1')).toBe(false)
    expect(isValidSchemaId('foo#bar')).toBe(false)
    expect(isValidSchemaId('constructor')).toBe(false)
    expect(isValidSchemaId('toString')).toBe(false)
    expect(isValidSchemaId('__proto__')).toBe(false)
    expect(isValidSchemaId(123)).toBe(false)
  })

  it('parses strictly positive integer schema versions', () => {
    expect(parseSchemaVersion('1')).toBe(1)
    expect(parseSchemaVersion('42')).toBe(42)
    expect(parseSchemaVersion('0')).toBeUndefined()
    expect(parseSchemaVersion('01')).toBeUndefined()
    expect(parseSchemaVersion('-1')).toBeUndefined()
    expect(parseSchemaVersion('1.5')).toBeUndefined()
    expect(parseSchemaVersion('abc')).toBeUndefined()
    expect(parseSchemaVersion('999999999999999999999')).toBeUndefined()
  })

  it('parses unversioned and versioned schema refs', () => {
    expect(parseSchemaRef('finding')).toEqual({ id: 'finding' })
    expect(parseSchemaRef('finding@2')).toEqual({ id: 'finding', version: 2 })
    expect(parseSchemaRef('bad/id')).toBeUndefined()
    expect(parseSchemaRef('bad/id@1')).toBeUndefined()
    expect(parseSchemaRef('finding@0')).toBeUndefined()
    expect(parseSchemaRef('finding@abc')).toBeUndefined()
    expect(parseSchemaRef('finding@1@2')).toBeUndefined()
  })

  it('formats canonical schema refs', () => {
    expect(formatSchemaRef('finding', 3)).toBe('finding@3')
  })
})
