import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  entryContentHash,
  isValidSourceEventId,
  MAX_SOURCE_EVENT_ID_LENGTH,
} from './source-event.mjs'

describe('sourceEventId helpers', () => {
  it('validates sourceEventId strings', () => {
    expect(isValidSourceEventId('evt-1')).toBe(true)
    expect(isValidSourceEventId('a'.repeat(MAX_SOURCE_EVENT_ID_LENGTH))).toBe(true)
    expect(isValidSourceEventId('')).toBe(false)
    expect(isValidSourceEventId('   ')).toBe(false)
    expect(isValidSourceEventId('a'.repeat(MAX_SOURCE_EVENT_ID_LENGTH + 1))).toBe(false)
    expect(isValidSourceEventId('evt\n1')).toBe(false)
    expect(isValidSourceEventId(123)).toBe(false)
  })

  it('produces identical hashes regardless of object key order and differs on semantic changes', () => {
    expect(canonicalJson({ b: 1, a: [2, { y: true, x: null }], skip: undefined })).toBe(
      '{"a":[2,{"x":null,"y":true}],"b":1}',
    )
    expect(canonicalJson({ a: 1, a2: 2 })).toBe('{"a":1,"a2":2}')

    const hashA = entryContentHash({ data: { b: 2, a: 1 }, schemaId: 'finding', schemaVersion: 1 })
    const hashB = entryContentHash({ data: { a: 1, b: 2 }, schemaId: 'finding', schemaVersion: 1 })
    const hashDiffData = entryContentHash({
      data: { a: 1, b: 3 },
      schemaId: 'finding',
      schemaVersion: 1,
    })
    const hashDiffSchema = entryContentHash({
      data: { a: 1, b: 2 },
      schemaId: 'finding',
      schemaVersion: 2,
    })
    expect(hashA).toBe(hashB)
    expect(hashA).not.toBe(hashDiffData)
    expect(hashA).not.toBe(hashDiffSchema)
  })
})
