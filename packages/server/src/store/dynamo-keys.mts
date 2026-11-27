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

export function schemaShadowCountsPk(id: string): string {
  return `SCHEMA_SHADOW_COUNTS#${id}`
}

export function schemaShadowCountSk(version: number): string {
  return `V#${String(version).padStart(10, '0')}`
}

export function schemaShadowFailuresPk(id: string, version: number): string {
  return `SCHEMA_SHADOW_FAILURES#${id}#V#${String(version).padStart(10, '0')}`
}

export function schemaShadowFailureSk(occurredAt: string, uniqueId: string): string {
  return `${occurredAt}#${uniqueId}`
}
