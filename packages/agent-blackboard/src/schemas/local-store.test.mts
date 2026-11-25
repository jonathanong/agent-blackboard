import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SchemaBundle } from '../client/schema-types.mjs'
import {
  DEFAULT_SCHEMAS_RELATIVE,
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

  it('writes and reads bundles atomically, removing stale files', () => {
    const dir = makeTempDir()
    const versionsDir = join(dir, 'versions')
    mkdirSync(versionsDir, { recursive: true })
    writeFileSync(join(dir, 'stale.json'), '{}')
    writeFileSync(join(dir, 'notes.txt'), 'keep')
    writeFileSync(join(versionsDir, 'stale@1.json'), '{}')

    const counts = writeLocalBundle(dir, SAMPLE_BUNDLE, () => new Date('2026-01-03T00:00:00.000Z'))
    expect(counts).toEqual({ schemaCount: 1, versionCount: 2 })

    const manifest = readLocalManifest(dir)
    expect(manifest?.revision).toBe(2)
    expect(manifest?.pulledAt).toBe('2026-01-03T00:00:00.000Z')

    const readBack = readLocalBundle(dir)
    expect(readBack).toEqual(SAMPLE_BUNDLE)

    // Write bundle with schema missing its latestVersion record covers optional top-file branch
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
