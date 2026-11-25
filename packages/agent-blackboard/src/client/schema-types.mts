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

type SchemaVersionMode = 'enforced' | 'shadow'

export interface SchemaVersionRecord {
  id: string
  version: number
  ref: string
  schema: Record<string, unknown>
  mode?: SchemaVersionMode
  createdAt: string
  createdBy: string
  promotedAt?: string | null
  promotedBy?: string | null
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
  mode?: SchemaVersionMode
  versionCreatedAt: string
  versionCreatedBy: string
  promotedAt?: string | null
  promotedBy?: string | null
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

export interface SchemaShadowWarning {
  code: string
  message: string
  schema?: string
  details?: SchemaValidationIssue[]
}

export interface PromoteSchemaResult extends SchemaVersionRecord {
  revision: number
  alreadyEnforced: boolean
}

interface SchemaShadowFailureRecord {
  schemaId: string
  schemaVersion: number
  sessionId: string
  occurredAt: string
  code: string
  message: string
  details: SchemaValidationIssue[]
}

interface SchemaShadowVersionCount {
  version: number
  ref: string
  mode: SchemaVersionMode
  failureCount: number
  lastFailureAt: string | null
}

export interface SchemaShadowReport {
  id: string
  version: number | null
  totalFailures: number
  versions: SchemaShadowVersionCount[]
  recentFailures: SchemaShadowFailureRecord[]
  revision: number
}
