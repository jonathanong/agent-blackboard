export interface SchemaSummary {
  id: string
  latestVersion: number
  deprecatedAt: string | null
  deprecatedBy: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface SchemaVersionRecord {
  id: string
  version: number
  ref: string
  schema: Record<string, unknown>
  createdAt: string
  createdBy: string
}

export interface SchemaWithVersions extends SchemaSummary {
  versions: SchemaVersionRecord[]
}

export interface SchemaBundle {
  revision: number
  schemas: SchemaWithVersions[]
}

export interface ListSchemasResult {
  revision: number
  schemas: SchemaSummary[]
}

export interface SchemaVersionDetail extends SchemaSummary {
  version: number
  ref: string
  schema: Record<string, unknown>
  versionCreatedAt: string
  versionCreatedBy: string
  revision: number
}

interface BreakingChange {
  path: string
  kind: string
  message: string
}

export interface PutSchemaResult extends SchemaVersionRecord {
  revision: number
  compatible: boolean
  breakingChanges: BreakingChange[]
}

export interface DeprecateSchemaResult {
  id: string
  latestVersion: number
  deprecatedAt: string | null
  deprecatedBy: string | null
  revision: number
}

export interface PullSchemasResult {
  upToDate: boolean
  revision: number
  schemaCount: number
  versionCount: number
  dir: string
}

export interface SchemaValidationIssue {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
}

export interface SchemaValidationResult {
  valid: boolean
  schema: string
  revision: number
  errors: SchemaValidationIssue[]
}
