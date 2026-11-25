import { describe, expect, it } from 'vitest'
import { formatSchemaRef, isValidSchemaId, parseSchemaRef, parseSchemaVersion } from './id.mjs'

describe('client schema id helpers', () => {
  it('validates schema ids and versions', () => {
    expect(isValidSchemaId('finding')).toBe(true)
    expect(isValidSchemaId('a..b')).toBe(false)
    expect(isValidSchemaId('a/b')).toBe(false)
    expect(isValidSchemaId('')).toBe(false)

    expect(parseSchemaVersion('1')).toBe(1)
    expect(parseSchemaVersion('0')).toBeUndefined()
    expect(parseSchemaVersion('999999999999999999999')).toBeUndefined()

    expect(parseSchemaRef('finding')).toEqual({ id: 'finding' })
    expect(parseSchemaRef('finding@2')).toEqual({ id: 'finding', version: 2 })
    expect(parseSchemaRef('bad/id')).toBeUndefined()
    expect(parseSchemaRef('bad/id@1')).toBeUndefined()
    expect(parseSchemaRef('finding@0')).toBeUndefined()

    expect(formatSchemaRef('finding', 2)).toBe('finding@2')
  })
})
