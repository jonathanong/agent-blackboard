import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type {
  SchemaBundle,
  SchemaSummary,
  SchemaVersionRecord,
  SchemaWithVersions,
} from '../client/schema-types.mjs'
import { enclosingWorktreeRoot } from '../session-id/persist.mjs'
import { formatSchemaRef, isValidSchemaId } from './id.mjs'

export const DEFAULT_SCHEMAS_RELATIVE = '.local/agent-blackboard/schemas'
const MANIFEST_FILE = 'manifest.json'
const VERSIONS_DIR = 'versions'
const LATEST_DIR = 'latest'

export interface LocalSchemaManifest {
  revision: number
  pulledAt: string
  /** Normalized server base URL this cache was pulled from. */
  source?: string
  /** SHA-256 digest of all version files so torn writes fail verification on read. */
  bundleHash?: string
  schemas: Array<SchemaSummary & { versions: number[] }>
}

/** Normalizes a server `baseUrl` into a canonical cache-origin key. */
export function normalizeRegistrySource(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return baseUrl.replace(/\/+$/, '')
  }
}

export function resolveSchemasDir(
  cwd: string,
  env: NodeJS.ProcessEnv,
  explicitDir?: string,
): string {
  if (explicitDir) return resolve(cwd, explicitDir)
  const envDir = env.AGENT_BLACKBOARD_SCHEMAS_DIR?.trim()
  if (envDir) return resolve(cwd, envDir)
  return join(enclosingWorktreeRoot(cwd), DEFAULT_SCHEMAS_RELATIVE)
}

function writeFileAtomic(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  const temp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temp, targetPath)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

export function readLocalManifest(dir: string): LocalSchemaManifest | undefined {
  try {
    const raw = readFileSync(join(dir, MANIFEST_FILE), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).revision === 'number' &&
      Array.isArray((parsed as Record<string, unknown>).schemas)
    ) {
      return parsed as LocalSchemaManifest
    }
    return undefined
  } catch {
    return undefined
  }
}

function removeStaleJsonFiles(dir: string, keep: Set<string>): void {
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json') && !keep.has(name)) {
      rmSync(join(dir, name), { force: true })
    }
  }
}

export function writeLocalBundle(
  dir: string,
  bundle: SchemaBundle,
  now: () => Date = () => new Date(),
  source?: string,
): { schemaCount: number; versionCount: number } {
  // Validate all ids and version numbers before writing any file so a bad bundle never leaves torn state.
  for (const entry of bundle.schemas) {
    if (!isValidSchemaId(entry.id)) {
      throw new Error(`refusing to write unsafe schema id: ${entry.id}`)
    }
    for (const versionRecord of entry.versions) {
      if (!Number.isSafeInteger(versionRecord.version) || versionRecord.version < 1) {
        throw new Error(`refusing to write invalid schema version for ${entry.id}`)
      }
    }
  }

  const versionsDir = join(dir, VERSIONS_DIR)
  const latestDir = join(dir, LATEST_DIR)
  mkdirSync(versionsDir, { recursive: true })
  mkdirSync(latestDir, { recursive: true })

  const keepLatest = new Set<string>()
  const keepVersions = new Set<string>()
  let versionCount = 0

  const manifestSchemas: LocalSchemaManifest['schemas'] = []
  const hash = createHash('sha256')
  for (const entry of bundle.schemas) {
    const versionNumbers: number[] = []
    for (const versionRecord of entry.versions) {
      const fileName = `${formatSchemaRef(entry.id, versionRecord.version)}.json`
      const serialized = `${JSON.stringify(versionRecord, null, 2)}\n`
      keepVersions.add(fileName)
      hash.update(`${fileName}\0${serialized}\0`)
      writeFileAtomic(join(versionsDir, fileName), serialized)
      versionNumbers.push(versionRecord.version)
      versionCount += 1
    }
    const latestRecord = entry.versions.find((v) => v.version === entry.latestVersion)
    if (latestRecord) {
      const latestFile = `${entry.id}.json`
      keepLatest.add(latestFile)
      writeFileAtomic(
        join(latestDir, latestFile),
        `${JSON.stringify(latestRecord.schema, null, 2)}\n`,
      )
    }
    const { versions: _omit, ...summary } = entry
    manifestSchemas.push({ ...summary, versions: versionNumbers })
  }

  removeStaleJsonFiles(versionsDir, keepVersions)
  removeStaleJsonFiles(latestDir, keepLatest)

  const manifest: LocalSchemaManifest = {
    revision: bundle.revision,
    pulledAt: now().toISOString(),
    ...(source === undefined ? {} : { source }),
    bundleHash: hash.digest('hex'),
    schemas: manifestSchemas,
  }
  writeFileAtomic(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
  return { schemaCount: bundle.schemas.length, versionCount }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidVersionRecord(
  value: unknown,
  expectedId: string,
  expectedVersion: number,
): value is SchemaVersionRecord {
  return (
    isPlainObject(value) &&
    value.id === expectedId &&
    value.version === expectedVersion &&
    typeof value.ref === 'string' &&
    isPlainObject(value.schema)
  )
}

export function readLocalBundle(dir: string, expectedSource?: string): SchemaBundle | undefined {
  const manifest = readLocalManifest(dir)
  if (!manifest) return undefined
  if (expectedSource !== undefined && manifest.source !== expectedSource) return undefined
  const versionsDir = join(dir, VERSIONS_DIR)
  const schemas: SchemaWithVersions[] = []
  const hash = createHash('sha256')
  try {
    for (const entry of manifest.schemas) {
      if (!isValidSchemaId(entry.id) || !Array.isArray(entry.versions)) return undefined
      const versions: SchemaVersionRecord[] = []
      for (const versionNum of entry.versions) {
        const fileName = `${formatSchemaRef(entry.id, versionNum)}.json`
        const raw = readFileSync(join(versionsDir, fileName), 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (!isValidVersionRecord(parsed, entry.id, versionNum)) return undefined
        hash.update(`${fileName}\0${raw}\0`)
        versions.push(parsed)
      }
      const { versions: _v, ...summary } = entry
      schemas.push({ ...summary, versions })
    }
  } catch {
    return undefined
  }
  if (manifest.bundleHash !== hash.digest('hex')) return undefined
  return { revision: manifest.revision, schemas }
}
