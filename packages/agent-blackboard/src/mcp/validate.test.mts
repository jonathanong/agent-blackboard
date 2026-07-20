import { describe, expect, it } from 'vitest'
import {
  expectObject,
  nullableString,
  optionalEntryFormat,
  optionalPositiveInt,
  requiredString,
} from './validate.mjs'

describe('MCP validation', () => {
  it('validates objects and required/nullable strings', () => {
    expect(expectObject({ a: 1 }, 'data')).toEqual({ a: 1 })
    for (const value of [null, [], 'x']) expect(() => expectObject(value, 'data')).toThrow()
    expect(requiredString('s', 'id')).toBe('s')
    for (const value of [undefined, '', 1]) expect(() => requiredString(value, 'id')).toThrow()
    expect(nullableString(null, 'parent')).toBeNull()
    expect(nullableString('p', 'parent')).toBe('p')
  })

  it('validates optional structured formats', () => {
    expect(optionalEntryFormat(undefined)).toBeUndefined()
    expect(optionalEntryFormat('json')).toBe('json')
    expect(optionalEntryFormat('jsonl')).toBe('jsonl')
    expect(() => optionalEntryFormat('markdown')).toThrow()
  })

  it('validates optional positive integers', () => {
    expect(optionalPositiveInt(undefined, 'limit')).toBeUndefined()
    expect(optionalPositiveInt(5, 'limit')).toBe(5)
    for (const value of [0, -1, 1.5, '5', null]) {
      expect(() => optionalPositiveInt(value, 'limit')).toThrow('positive integer')
    }
  })
})
