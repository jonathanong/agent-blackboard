import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SchemaBundle } from '../client/schema-types.mjs'
import { writeLocalBundle } from './local-store.mjs'
import { validateAgainstBundle, validateAgainstLocalSchemas } from './validate.mjs'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'abb-schemas-val-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const BUNDLE: SchemaBundle = {
  revision: 4,
  schemas: [
    {
      id: 'common',
      latestVersion: 1,
      deprecatedAt: null,
      deprecatedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'ops',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'ops',
      versions: [
        {
          id: 'common',
          version: 1,
          ref: 'common@1',
          schema: {
            type: 'object',
            $defs: { stamp: { type: 'string', format: 'date-time' } },
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'ops',
        },
      ],
    },
    {
      id: 'finding',
      latestVersion: 2,
      deprecatedAt: null,
      deprecatedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'ops',
      updatedAt: '2026-01-02T00:00:00.000Z',
      updatedBy: 'ops',
      versions: [
        {
          id: 'finding',
          version: 1,
          ref: 'finding@1',
          schema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'ops',
        },
        {
          id: 'finding',
          version: 2,
          ref: 'finding@2',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              when: { $ref: 'common@1#/$defs/stamp' },
            },
            required: ['title', 'when'],
          },
          createdAt: '2026-01-02T00:00:00.000Z',
          createdBy: 'ops',
        },
      ],
    },
    {
      id: 'old',
      latestVersion: 1,
      deprecatedAt: '2026-01-03T00:00:00.000Z',
      deprecatedBy: 'ops',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'ops',
      updatedAt: '2026-01-03T00:00:00.000Z',
      updatedBy: 'ops',
      versions: [
        {
          id: 'old',
          version: 1,
          ref: 'old@1',
          schema: { type: 'object' },
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'ops',
        },
      ],
    },
    {
      id: 'empty-versions',
      latestVersion: 1,
      deprecatedAt: null,
      deprecatedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'ops',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'ops',
      versions: [],
    },
  ],
}

describe('offline schema validation', () => {
  it('validates against latest and pinned local schemas with cross-schema refs', () => {
    const dir = makeTempDir()
    expect(() => validateAgainstLocalSchemas(dir, 'finding', {})).toThrow(/schemas pull/)

    writeLocalBundle(dir, BUNDLE)
    expect(
      validateAgainstLocalSchemas(dir, 'finding', {
        title: 'Bug',
        when: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({ valid: true, schema: 'finding@2', revision: 4, errors: [] })

    expect(validateAgainstLocalSchemas(dir, 'finding@1', { title: 'Bug' })).toEqual({
      valid: true,
      schema: 'finding@1',
      revision: 4,
      errors: [],
    })

    const invalid = validateAgainstLocalSchemas(dir, 'finding', { title: 123 })
    expect(invalid.valid).toBe(false)
    expect(invalid.schema).toBe('finding@2')
    expect(invalid.errors.length).toBeGreaterThan(0)
  })

  it('rejects invalid refs, missing schemas/versions, and deprecated schemas', () => {
    expect(() => validateAgainstBundle(BUNDLE, 'bad/ref', {})).toThrow(/Invalid schema reference/)
    expect(() => validateAgainstBundle(BUNDLE, 'missing', {})).toThrow(/not found/)
    expect(() => validateAgainstBundle(BUNDLE, 'old', {})).toThrow(/deprecated/)
    expect(() => validateAgainstBundle(BUNDLE, 'finding@99', {})).toThrow(/version not found/)
  })
})
