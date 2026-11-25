import { describe, expect, it } from 'vitest'
import { checkBackwardCompatibility } from './compatibility.mjs'

describe('checkBackwardCompatibility', () => {
  it('treats additive and widening changes as compatible', () => {
    const prev = {
      type: 'object',
      required: ['title'],
      properties: {
        title: {
          type: 'string',
          minLength: 3,
          maxLength: 50,
          pattern: '^[a-z]+$',
          format: 'hostname',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          exclusiveMinimum: 0,
          exclusiveMaximum: 11,
          multipleOf: 2,
        },
        status: { enum: ['open', { nested: [1, 2] }] },
        kind: { const: 'finding' },
        tags: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: { type: 'string' },
        },
        meta: {
          type: 'object',
          minProperties: 1,
          maxProperties: 5,
          additionalProperties: { type: 'string' },
        },
        refField: { $ref: 'common@1' },
      },
    }
    const next = {
      type: 'object',
      required: ['title'],
      properties: {
        title: {
          type: ['string', 'null'],
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-z]+$',
          format: 'hostname',
        },
        count: {
          type: 'number',
          minimum: 0,
          maximum: 20,
          exclusiveMinimum: -1,
          exclusiveMaximum: 21,
          multipleOf: 2,
        },
        status: { enum: ['open', { nested: [1, 2] }, 'closed'] },
        kind: { const: 'finding' },
        tags: {
          type: 'array',
          minItems: 0,
          maxItems: 10,
          uniqueItems: false,
          items: { type: ['string', 'number'] },
        },
        meta: { type: 'object', minProperties: 0, maxProperties: 10, additionalProperties: true },
        refField: { $ref: 'common@1' },
        optionalNote: { type: 'string' },
      },
    }
    expect(checkBackwardCompatibility(prev, next)).toEqual({
      compatible: true,
      breakingChanges: [],
    })
  })

  it('detects new required fields, removed properties, and narrowed types/enums/consts/refs', () => {
    const prev = {
      type: 'object',
      required: ['a'],
      properties: {
        a: { type: ['string', 'number'] },
        b: { enum: ['x', { k: 1, m: [1] }] },
        c: { const: { a: 1 } },
        d: {},
        removed: { type: 'string' },
        refField: { $ref: 'common@1' },
        nestedSlash: { type: 'object', properties: { 'a/b~c': { type: 'number' } } },
      },
    }
    const next = {
      type: 'object',
      required: ['a', 'd'],
      properties: {
        a: { type: 'string' },
        b: { enum: ['x', { k: 2 }, { k: 1, m: [1, 2] }, { k: 1, x: 2 }, 'other'] },
        c: { const: { a: 2 } },
        d: { type: 'string', enum: ['only'], const: 'only' },
        refField: { $ref: 'common@2' },
        nestedSlash: { type: 'object', properties: { 'a/b~c': { type: 'integer' } } },
      },
    }
    const result = checkBackwardCompatibility(prev, next)
    expect(result.compatible).toBe(false)
    const kinds = new Set(result.breakingChanges.map((change) => change.kind))
    expect(kinds).toEqual(
      new Set([
        'added_required',
        'removed_property',
        'narrowed_type',
        'narrowed_enum',
        'narrowed_const',
        'changed_ref',
      ]),
    )
    expect(
      result.breakingChanges.some((c) => c.path === '/properties/nestedSlash/properties/a~1b~0c'),
    ).toBe(true)
  })

  it('detects narrowed numeric, string, array, and object constraints', () => {
    const prev = {
      type: 'object',
      properties: {
        num: { type: 'number', minimum: 1, maximum: 10 },
        str: { type: 'string', minLength: 1, maxLength: 10 },
        arr: { type: 'array', minItems: 1, maxItems: 5 },
        arr2: { type: 'array', items: { type: 'string' } },
        obj: { type: 'object' },
        obj2: { type: 'object', additionalProperties: { type: 'string' } },
        obj3: { type: 'object' },
      },
    }
    const next = {
      type: 'object',
      properties: {
        num: {
          type: 'number',
          minimum: 2,
          maximum: 9,
          exclusiveMinimum: 1,
          exclusiveMaximum: 10,
          multipleOf: 5,
        },
        str: { type: 'string', minLength: 2, maxLength: 8, pattern: '^a', format: 'email' },
        arr: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          uniqueItems: true,
          items: { type: 'string' },
        },
        arr2: { type: 'array', items: { type: 'integer' } },
        obj: { type: 'object', minProperties: 1, maxProperties: 2, additionalProperties: false },
        obj2: { type: 'object', additionalProperties: { type: 'integer' } },
        obj3: { type: 'object', additionalProperties: { type: 'string' } },
      },
    }
    const result = checkBackwardCompatibility(prev, next)
    expect(result.compatible).toBe(false)
    expect(result.breakingChanges.length).toBeGreaterThanOrEqual(14)
  })

  it('handles non-object jsonEqual edge cases cleanly', () => {
    expect(
      checkBackwardCompatibility(
        { enum: [null, [1], { a: 1 }] },
        { enum: [1, { a: 1, b: 2 }, [1, 2]] },
      ).compatible,
    ).toBe(false)
    expect(
      checkBackwardCompatibility({ properties: { a: true } }, { properties: { a: true } })
        .compatible,
    ).toBe(true)
  })
})
