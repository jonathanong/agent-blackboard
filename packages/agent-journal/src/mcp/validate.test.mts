import { describe, expect, it } from 'vitest'
import { expectObject, optionalBoolean, optionalEntryFormat, optionalString } from './validate.mjs'

describe('expectObject', () => {
  it('returns plain objects', () => {
    expect(expectObject({ a: 1 }, 'data')).toEqual({ a: 1 })
  })

  it.each([undefined, null, 'x', 1, ['a']])('throws for %p', (value) => {
    expect(() => expectObject(value, 'data')).toThrow('"data" must be an object.')
  })
})

describe('optionalString', () => {
  it('returns undefined when unset', () => {
    expect(optionalString(undefined, 'sessionId')).toBeUndefined()
  })

  it('returns the string', () => {
    expect(optionalString('s1', 'sessionId')).toBe('s1')
  })

  it('throws for a non-string', () => {
    expect(() => optionalString(1, 'sessionId')).toThrow('"sessionId" must be a string.')
  })
})

describe('optionalBoolean', () => {
  it('returns undefined when unset', () => {
    expect(optionalBoolean(undefined, 'archived')).toBeUndefined()
  })

  it('returns the boolean', () => {
    expect(optionalBoolean(true, 'archived')).toBe(true)
  })

  it('throws for a non-boolean', () => {
    expect(() => optionalBoolean('true', 'archived')).toThrow('"archived" must be a boolean.')
  })
})

describe('optionalEntryFormat', () => {
  it('returns undefined when unset', () => {
    expect(optionalEntryFormat(undefined)).toBeUndefined()
  })

  it('accepts json and jsonl', () => {
    expect(optionalEntryFormat('json')).toBe('json')
    expect(optionalEntryFormat('jsonl')).toBe('jsonl')
  })

  it('throws for anything else', () => {
    expect(() => optionalEntryFormat('markdown')).toThrow('"format" must be "json" or "jsonl".')
  })
})
