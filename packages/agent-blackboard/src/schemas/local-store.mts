import { randomUUID } from 'node:crypto'
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

export interface LocalSchemaManifest {
  revision: number
  pulledAt: string
  schemas: Array<SchemaSummary & { versions: number[] }>
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
): { schemaCount: number; versionCount: number } {
  const versionsDir = join(dir, VERSIONS_DIR)
  mkdirSync(versionsDir, { recursive: true })

  const keepTop = new Set<string>([MANIFEST_FILE])
  const keepVersions = new Set<string>()
  let versionCount = 0

  const manifestSchemas: LocalSchemaManifest['schemas'] = []
  for (const entry of bundle.schemas) {
    if (!isValidSchemaId(entry.id)) {
      throw new Error(`refusing to write unsafe schema id: ${entry.id}`)
    }
    const versionNumbers: number[] = []
    for (const versionRecord of entry.versions) {
      const fileName = `${formatSchemaRef(entry.id, versionRecord.version)}.json`
      keepVersions.add(fileName)
      writeFileAtomic(join(versionsDir, fileName), `${JSON.stringify(versionRecord, null, 2)}\n`)
      versionNumbers.push(versionRecord.version)
      versionCount += 1
    }
    const latestRecord = entry.versions.find((v) => v.version === entry.latestVersion)
    if (latestRecord) {
      const topFile = `${entry.id}.json`
      keepTop.add(topFile)
      writeFileAtomic(join(dir, topFile), `${JSON.stringify(latestRecord.schema, null, 2)}\n`)
    }
    const { versions: _omit, ...summary } = entry
    manifestSchemas.push({ ...summary, versions: versionNumbers })
  }

  removeStaleJsonFiles(versionsDir, keepVersions)
  removeStaleJsonFiles(dir, keepTop)

  const manifest: LocalSchemaManifest = {
    revision: bundle.revision,
    pulledAt: now().toISOString(),
    schemas: manifestSchemas,
  }
  writeFileAtomic(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
  return { schemaCount: bundle.schemas.length, versionCount }
}

export function readLocalBundle(dir: string): SchemaBundle | undefined {
  const manifest = readLocalManifest(dir)
  if (!manifest) return undefined
  const versionsDir = join(dir, VERSIONS_DIR)
  const schemas: SchemaWithVersions[] = []
  for (const entry of manifest.schemas) {
    if (!isValidSchemaId(entry.id)) return undefined
    const versions: SchemaVersionRecord[] = []
    for (const versionNum of entry.versions) {
      const filePath = join(versionsDir, `${formatSchemaRef(entry.id, versionNum)}.json`)
      const raw = readFileSync(filePath, 'utf8')
      versions.push(JSON.parse(raw) as SchemaVersionRecord)
    }
    const { versions: _v, ...summary } = entry
    schemas.push({ ...summary, versions })
  }
  return { revision: manifest.revision, schemas }
}
