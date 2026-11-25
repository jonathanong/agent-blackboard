import { describe, expect, it } from 'vitest'
import type { SchemaBundle } from '../core/types.mjs'
import { compileRegisteredSchema } from './compile.mjs'

function makeBundle(
  schemas: Array<{
    id: string
    deprecatedAt?: string | null
    versions: Array<{ version: number; schema: Record<string, unknown> }>
  }>,
): SchemaBundle {
  return {
    revision: 1,
    schemas: schemas.map((item) => ({
      id: item.id,
      latestVersion: item.versions.at(-1)?.version ?? 1,
      deprecatedAt: item.deprecatedAt ?? null,
      deprecatedBy: item.deprecatedAt ? 'admin' : null,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'admin',
      versions: item.versions.map((v) => ({
        id: item.id,
        version: v.version,
        ref: `${item.id}@${v.version}`,
        schema: v.schema,
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'admin',
      })),
    })),
  }
}

describe('compileRegisteredSchema', () => {
  it('compiles a valid 2020-12 schema with formats and transitive registered refs', () => {
    const bundle = makeBundle([
      {
        id: 'base',
        versions: [
          {
            version: 1,
            schema: {
              type: 'object',
              $defs: { stamp: { type: 'string', format: 'date-time' } },
              properties: { ts: { $ref: '#/$defs/stamp' } },
            },
          },
        ],
      },
      {
        id: 'wrapper',
        versions: [
          {
            version: 1,
            schema: {
              type: 'object',
              properties: {
                a: { $ref: 'base@1#/$defs/stamp' },
                b: { $ref: 'base@1#/$defs/stamp' },
              },
              required: ['a'],
            },
          },
        ],
      },
    ])

    const result = compileRegisteredSchema(
      {
        id: 'finding',
        version: 1,
        schema: {
          type: 'object',
          properties: { wrapped: { $ref: 'wrapper' }, stamp: { $ref: 'base@1#/$defs/stamp' } },
          required: ['wrapped'],
        },
      },
      bundle,
      { rejectDeprecatedRefs: true },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.validate({ wrapped: { a: '2026-01-01T00:00:00Z' } })).toBe(true)
      expect(result.validate({ wrapped: { a: 'not-a-date' } })).toBe(false)
    }
  })

  it('rejects missing, deprecated, invalid, circular, and uncompilable schemas', () => {
    const bundle = makeBundle([
      {
        id: 'deprecated-schema',
        deprecatedAt: '2026-01-02T00:00:00.000Z',
        versions: [{ version: 1, schema: { type: 'object' } }],
      },
      {
        id: 'cycle-a',
        versions: [
          { version: 1, schema: { type: 'object', properties: { b: { $ref: 'cycle-b' } } } },
        ],
      },
      {
        id: 'cycle-b',
        versions: [
          { version: 1, schema: { type: 'object', properties: { a: { $ref: 'cycle-a' } } } },
        ],
      },
      {
        id: 'bad-dep',
        versions: [{ version: 1, schema: { $id: 'https://bad.example/s', type: 'object' } }],
      },
    ])

    expect(
      compileRegisteredSchema({ id: 'x', version: 1, schema: { $schema: 'draft-07' } }, bundle),
    ).toMatchObject({ ok: false })
    expect(
      compileRegisteredSchema(
        { id: 'x', version: 1, schema: { properties: { a: { $ref: 'missing' } } } },
        bundle,
      ),
    ).toMatchObject({ ok: false, error: 'referenced schema not found: missing' })
    expect(
      compileRegisteredSchema(
        { id: 'x', version: 1, schema: { properties: { a: { $ref: 'deprecated-schema@99' } } } },
        bundle,
      ),
    ).toMatchObject({
      ok: false,
      error: 'referenced schema version not found: deprecated-schema@99',
    })
    expect(
      compileRegisteredSchema(
        { id: 'x', version: 1, schema: { properties: { a: { $ref: 'deprecated-schema' } } } },
        bundle,
        { rejectDeprecatedRefs: true },
      ),
    ).toMatchObject({ ok: false, error: 'referenced schema is deprecated: deprecated-schema' })
    expect(
      compileRegisteredSchema(
        { id: 'x', version: 1, schema: { properties: { a: { $ref: 'deprecated-schema' } } } },
        bundle,
        { rejectDeprecatedRefs: false },
      ),
    ).toMatchObject({ ok: true })
    expect(
      compileRegisteredSchema(
        { id: 'self', version: 1, schema: { properties: { s: { $ref: 'self' } } } },
        bundle,
      ),
    ).toMatchObject({ ok: false, error: 'circular schema reference: self' })
    expect(
      compileRegisteredSchema(
        { id: 'entry', version: 1, schema: { properties: { c: { $ref: 'cycle-a' } } } },
        bundle,
      ),
    ).toMatchObject({ ok: false, error: 'circular schema reference: cycle-a' })
    expect(
      compileRegisteredSchema(
        { id: 'entry', version: 1, schema: { properties: { d: { $ref: 'bad-dep' } } } },
        bundle,
      ),
    ).toMatchObject({ ok: false })
    expect(
      compileRegisteredSchema(
        { id: 'broken', version: 1, schema: { type: 'object', unknownKeyword: 123 } },
        bundle,
      ),
    ).toMatchObject({ ok: false })
  })
})
