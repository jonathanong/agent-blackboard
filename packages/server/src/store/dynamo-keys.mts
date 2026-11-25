export function sessionsPk(credId: string): string {
  return `SESSIONS#${credId}`
}

const SESSION_SK_PREFIX = 'SESSION#'

export function sessionSk(sessionId: string): string {
  return `${SESSION_SK_PREFIX}${sessionId}`
}

export function sessionIdFromSk(sk: string): string {
  return sk.slice(SESSION_SK_PREFIX.length)
}

export function entriesPk(credId: string, sessionId: string): string {
  return `ENTRIES#${credId}#${sessionId}`
}

export function entrySk(createdAt: string): string {
  return `ENTRY#${createdAt}`
}

export const SCHEMA_REGISTRY_PK = 'SCHEMA_REGISTRY'
export const SCHEMA_REGISTRY_SK = 'META'
export const SCHEMAS_PK = 'SCHEMAS'
export const SCHEMA_VERSIONS_PK = 'SCHEMA_VERSIONS'

const SCHEMA_SK_PREFIX = 'SCHEMA#'

export function schemaSk(id: string): string {
  return `${SCHEMA_SK_PREFIX}${id}`
}

export function schemaVersionPrefix(id: string): string {
  return `${SCHEMA_SK_PREFIX}${id}#V#`
}

export function schemaVersionSk(id: string, version: number): string {
  return `${schemaVersionPrefix(id)}${String(version).padStart(10, '0')}`
}
