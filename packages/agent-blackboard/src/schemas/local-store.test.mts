import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SchemaBundle } from '../client/schema-types.mjs'
import {
  DEFAULT_SCHEMAS_RELATIVE,
  normalizeRegistrySource,
  readLocalBundle,
  readLocalManifest,
  resolveSchemasDir,
  writeLocalBundle,
} from './local-store.mjs'

const dirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'abb-schemas-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const SAMPLE_BUNDLE: SchemaBundle = {
  revision: 2,
  schemas: [
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
            properties: { title: { type: 'string' }, note: { type: 'string' } },
            required: ['title'],
          },
          createdAt: '2026-01-02T00:00:00.000Z',
          createdBy: 'ops',
        },
      ],
    },
  ],
}

describe('local schema store', () => {
  it('resolves explicit dir, env dir, and worktree default dir', () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, '.git'))
    const nested = join(dir, 'sub')
    mkdirSync(nested)

    expect(resolveSchemasDir(nested, {}, 'custom')).toBe(join(nested, 'custom'))
    expect(resolveSchemasDir(nested, { AGENT_BLACKBOARD_SCHEMAS_DIR: 'from-env' })).toBe(
      join(nested, 'from-env'),
    )
    expect(resolveSchemasDir(nested, {})).toBe(join(dir, DEFAULT_SCHEMAS_RELATIVE))
  })

  it('writes and reads bundles atomically, removing stale files and avoiding manifest collision', () => {
    const dir = makeTempDir()
    const versionsDir = join(dir, 'versions')
    const latestDir = join(dir, 'latest')
    mkdirSync(versionsDir, { recursive: true })
    mkdirSync(latestDir, { recursive: true })
    writeFileSync(join(latestDir, 'stale.json'), '{}')
    writeFileSync(join(latestDir, 'notes.txt'), 'keep')
    writeFileSync(join(versionsDir, 'stale@1.json'), '{}')

    const withManifestSchema: SchemaBundle = {
      revision: 2,
      schemas: [
        ...SAMPLE_BUNDLE.schemas,
        {
          ...SAMPLE_BUNDLE.schemas[0]!,
          id: 'manifest',
          latestVersion: 1,
          versions: [
            {
              id: 'manifest',
              version: 1,
              ref: 'manifest@1',
              schema: { type: 'object' },
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'ops',
            },
          ],
        },
      ],
    }

    const counts = writeLocalBundle(
      dir,
      withManifestSchema,
      () => new Date('2026-01-03T00:00:00.000Z'),
      normalizeRegistrySource('https://example.com/api/'),
    )
    expect(counts).toEqual({ schemaCount: 2, versionCount: 3 })
    expect(normalizeRegistrySource('not a url///')).toBe('not a url')

    const manifest = readLocalManifest(dir)
    expect(manifest?.revision).toBe(2)
    expect(manifest?.pulledAt).toBe('2026-01-03T00:00:00.000Z')
    expect(manifest?.source).toBe('https://example.com/api')

    const readBack = readLocalBundle(dir, 'https://example.com/api')
    expect(readBack).toEqual(withManifestSchema)
    expect(readLocalBundle(dir, 'https://other.example.com')).toBeUndefined()

    // Torn write (a version file modified without updating manifest) fails bundleHash check
    writeFileSync(
      join(versionsDir, 'finding@1.json'),
      `${JSON.stringify({ ...SAMPLE_BUNDLE.schemas[0]!.versions[0]!, schema: { type: 'object', additionalProperties: false } }, null, 2)}\n`,
    )
    expect(readLocalBundle(dir, 'https://example.com/api')).toBeUndefined()

    // Corrupt version record (empty object) makes readLocalBundle return undefined so pull heals
    writeFileSync(join(versionsDir, 'finding@1.json'), '{}')
    expect(readLocalBundle(dir)).toBeUndefined()

    // Missing version file makes readLocalBundle return undefined so pull heals the cache
    rmSync(join(versionsDir, 'finding@1.json'))
    expect(readLocalBundle(dir)).toBeUndefined()

    // Write bundle with schema missing its latestVersion record covers optional latest-file branch
    const emptyLatest = writeLocalBundle(dir, {
      revision: 3,
      schemas: [{ ...SAMPLE_BUNDLE.schemas[0]!, latestVersion: 99, versions: [] }],
    })
    expect(emptyLatest).toEqual({ schemaCount: 1, versionCount: 0 })
  })

  it('handles missing, corrupt, or unsafe manifests and write failures', () => {
    const dir = makeTempDir()
    expect(readLocalManifest(dir)).toBeUndefined()
    expect(readLocalBundle(dir)).toBeUndefined()

    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ wrong: true }))
    expect(readLocalManifest(dir)).toBeUndefined()

    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ revision: 1, pulledAt: 'now', schemas: [{ id: '../bad', versions: [] }] }),
    )
    expect(readLocalBundle(dir)).toBeUndefined()

    expect(() =>
      writeLocalBundle(dir, {
        revision: 1,
        schemas: [{ ...SAMPLE_BUNDLE.schemas[0]!, id: '../bad' }],
      }),
    ).toThrow(/unsafe schema id/)

    expect(() =>
      writeLocalBundle(dir, {
        revision: 1,
        schemas: [
          {
            ...SAMPLE_BUNDLE.schemas[0]!,
            versions: [{ ...SAMPLE_BUNDLE.schemas[0]!.versions[0]!, version: 0 }],
          },
        ],
      }),
    ).toThrow(/invalid schema version/)

    // Atomic write failure cleans up temp file and rethrows
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'not-a-dir')
    expect(() => writeLocalBundle(join(blocked, 'sub'), SAMPLE_BUNDLE)).toThrow()

    // Rename failure when target path is a directory
    const dirTarget = join(dir, 'target-is-dir')
    mkdirSync(join(dirTarget, 'manifest.json'), { recursive: true })
    expect(() => writeLocalBundle(dirTarget, { revision: 1, schemas: [] })).toThrow()
  })
})
