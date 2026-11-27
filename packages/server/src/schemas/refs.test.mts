import { describe, expect, it } from 'vitest'
import { JSON_SCHEMA_2020_12, validateSchemaDocument } from './refs.mjs'

describe('validateSchemaDocument', () => {
  it('accepts JSON Schema 2020-12 documents with internal and registered $ref', () => {
    const result = validateSchemaDocument({
      $schema: JSON_SCHEMA_2020_12,
      type: 'object',
      $defs: { tag: { type: 'string' } },
      properties: {
        tag: { $ref: '#/$defs/tag' },
        author: { $ref: 'common@1#/$defs/author' },
        meta: { $ref: 'metadata' },
        default: { $ref: 'default-prop@1' },
      },
      allOf: [{ type: 'object' }],
      dependentRequired: { $schema: ['tag'] },
      default: { $ref: 'https://ignored-literal-default.example.com' },
    })
    expect(result).toEqual({
      ok: true,
      refs: [{ id: 'common', version: 1 }, { id: 'metadata' }, { id: 'default-prop', version: 1 }],
    })
  })

  it('accepts omitted $schema and trailing-# draft URI', () => {
    expect(validateSchemaDocument({ type: 'object' })).toEqual({ ok: true, refs: [] })
    expect(validateSchemaDocument({ $schema: `${JSON_SCHEMA_2020_12}#`, type: 'object' })).toEqual({
      ok: true,
      refs: [],
    })
  })

  it('rejects non-object schemas and unsupported $schema drafts', () => {
    expect(validateSchemaDocument(null)).toEqual({
      ok: false,
      error: 'schema must be a JSON object',
    })
    expect(validateSchemaDocument([])).toEqual({ ok: false, error: 'schema must be a JSON object' })
    expect(
      validateSchemaDocument({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      }),
    ).toMatchObject({ ok: false })
    expect(validateSchemaDocument({ $schema: 2020 })).toMatchObject({ ok: false })
  })

  it('rejects remote $ref, $dynamicRef, and $id anywhere in the schema tree', () => {
    expect(
      validateSchemaDocument({
        type: 'object',
        properties: { a: { $ref: 'https://evil.example/s.json' } },
      }),
    ).toMatchObject({ ok: false })
    expect(validateSchemaDocument({ anyOf: [{ $ref: '../escape.json' }] })).toMatchObject({
      ok: false,
    })
    expect(validateSchemaDocument({ type: 'object', $dynamicRef: '#meta' })).toMatchObject({
      ok: false,
    })
    expect(validateSchemaDocument({ type: 'object', $async: true })).toMatchObject({ ok: false })
    expect(
      validateSchemaDocument({ $id: 'https://example.com/finding.json', type: 'object' }),
    ).toMatchObject({ ok: false })
    expect(
      validateSchemaDocument({
        type: 'object',
        properties: { default: { $ref: 'https://evil.example/bypass.json' } },
      }),
    ).toMatchObject({ ok: false })
    expect(
      validateSchemaDocument({ type: 'object', properties: { x: { $ref: 123 } } }),
    ).toMatchObject({ ok: false })
    expect(
      validateSchemaDocument({
        type: 'object',
        properties: { x: { $schema: 'http://json-schema.org/draft-07/schema#' } },
      }),
    ).toMatchObject({ ok: false })
  })
})
