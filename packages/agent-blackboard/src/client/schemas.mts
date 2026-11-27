import {
  normalizeRegistrySource,
  readLocalBundle,
  resolveSchemasDir,
  writeLocalBundle,
} from '../schemas/local-store.mjs'
import { validateAgainstLocalSchemas } from '../schemas/validate.mjs'
import type {
  ListSchemasResult,
  ListSchemaVersionsResult,
  PullSchemasResult,
  SchemaValidationResult,
  SchemaVersionDetail,
} from './schema-types.mjs'
import {
  fetchSchemaBundleRequest,
  getSchemaRequest,
  listSchemasRequest,
  listSchemaVersionsRequest,
} from './schemas-client.mjs'
import type { ClientConfig } from './types.mjs'

export interface LocalSchemaOptions {
  /** Explicit local schema directory; overrides `AGENT_BLACKBOARD_SCHEMAS_DIR` and worktree default. */
  dir?: string
  /** Working directory for worktree-root discovery; defaults to `process.cwd()`. */
  cwd?: string
  /** Environment map checked for `AGENT_BLACKBOARD_SCHEMAS_DIR`; defaults to `{}`. */
  env?: NodeJS.ProcessEnv
}

/**
 * Read-only client for the Agent Blackboard JSON Schema registry plus local offline
 * pull/validation helpers. Schema writes (`put`, `remove`) are CLI/admin-only.
 */
export class Schemas {
  readonly #config: ClientConfig

  constructor(config: ClientConfig) {
    this.#config = config
  }

  list(): Promise<ListSchemasResult> {
    return listSchemasRequest(this.#config)
  }

  get(id: string, version?: number): Promise<SchemaVersionDetail> {
    return getSchemaRequest(this.#config, id, version)
  }

  listVersions(id: string): Promise<ListSchemaVersionsResult> {
    return listSchemaVersionsRequest(this.#config, id)
  }

  async pull(options: LocalSchemaOptions = {}): Promise<PullSchemasResult> {
    const dir = resolveSchemasDir(options.cwd ?? process.cwd(), options.env ?? {}, options.dir)
    const source = normalizeRegistrySource(this.#config.baseUrl)
    const local = readLocalBundle(dir, source)
    let fetched = await fetchSchemaBundleRequest(this.#config, local?.revision)
    if (fetched.notModified) {
      const current = readLocalBundle(dir, source)
      if (current) {
        return {
          upToDate: true,
          revision: current.revision,
          schemaCount: current.schemas.length,
          versionCount: current.schemas.reduce((sum, item) => sum + item.versions.length, 0),
          dir,
        }
      }
      if (local) {
        fetched = await fetchSchemaBundleRequest(this.#config)
      }
      if (fetched.notModified) {
        return { upToDate: true, revision: fetched.revision, schemaCount: 0, versionCount: 0, dir }
      }
    }
    const current = readLocalBundle(dir, source)
    if (current && current.revision > fetched.bundle.revision) {
      return {
        upToDate: true,
        revision: current.revision,
        schemaCount: current.schemas.length,
        versionCount: current.schemas.reduce((sum, item) => sum + item.versions.length, 0),
        dir,
      }
    }
    const counts = writeLocalBundle(dir, fetched.bundle, undefined, source)
    return {
      upToDate: false,
      revision: fetched.bundle.revision,
      schemaCount: counts.schemaCount,
      versionCount: counts.versionCount,
      dir,
    }
  }

  validateLocal(
    schemaRef: string,
    data: unknown,
    options: LocalSchemaOptions = {},
  ): SchemaValidationResult {
    const dir = resolveSchemasDir(options.cwd ?? process.cwd(), options.env ?? {}, options.dir)
    return validateAgainstLocalSchemas(dir, schemaRef, data)
  }
}
