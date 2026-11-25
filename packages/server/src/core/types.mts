/**
 * Shared types for the framework-agnostic server core. See `handle-request.mts`
 * for the full documented contract of how a `HandlerRequest` is produced and
 * how a `HandlerResponse` should be consumed by adapters (Lambda, local-server).
 */

/** HTTP header map. Keys MUST be lower-cased by the adapter before calling `handleRequest`. */
export type HeaderMap = Record<string, string>

/** Parsed query-string params. Repeated keys: last value wins (adapter's responsibility). */
export type QueryMap = Record<string, string | undefined>

export type BodyChunk = string | Uint8Array

/**
 * Request body. An adapter may hand us any of:
 *  - `undefined` — no body
 *  - `string | Uint8Array` — the full body, already buffered by the adapter
 *  - `AsyncIterable<BodyChunk>` — a streamed/chunked body (e.g. a `node:http`
 *    `IncomingMessage`, or a Lambda body stream)
 *  - an already-parsed JSON value (plain object/array/etc.) if the adapter
 *    chose to `JSON.parse` upstream itself
 *
 * TypeScript can't express this union precisely without collapsing to
 * `unknown` (the last case overlaps every other JS value), so it's `unknown`
 * here and the real discrimination happens at runtime in `core/body.mts`.
 */
export type RequestBody = unknown

export interface HandlerRequest {
  /** Already upper-cased, e.g. "GET" — matches `node:http` and Lambda Function URL events. */
  method: string
  /** URL path only, no query string, e.g. "/sessions/s1/entries". */
  path: string
  query: QueryMap
  headers: HeaderMap
  body?: RequestBody
}

/**
 * Response body is ALWAYS an async-iterable of chunks — even for small,
 * non-streaming responses (a single-chunk generator) — so adapters can
 * consume every response the same way regardless of route.
 */
export interface HandlerResponse {
  status: number
  headers: HeaderMap
  body: AsyncIterable<BodyChunk>
}

/** Session metadata. Semantic ids and parent relationships always come from callers. */
export interface Session {
  id: string
  parentSessionId: string | null
  agent: string
  version: string
  createdAt: string
  lastEntryAt: string | null
  archivedAt: string | null
  data: Record<string, unknown>
}

/** One timestamp-addressed entry belonging to a session. */
export interface SessionEntry {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
}

/** A stored API credential. The raw token is never persisted or returned after creation. */
export interface CredentialRecord {
  id: string
  name: string
  tokenHash: string
  createdAt: string
}

/** Registry summary for one registered JSON Schema id. */
export interface SchemaRecord {
  id: string
  latestVersion: number
  deprecatedAt: string | null
  deprecatedBy: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

/** Enforcement state for a single immutable schema version. */
export type SchemaVersionMode = 'enforced' | 'shadow'

/** One immutable version of a registered JSON Schema (`<id>@<version>`). */
export interface SchemaVersionRecord {
  id: string
  version: number
  ref: string
  schema: Record<string, unknown>
  mode: SchemaVersionMode
  createdAt: string
  createdBy: string
  promotedAt: string | null
  promotedBy: string | null
}

/** A single Ajv validation diagnostic (never carries the raw entry payload). */
export interface SchemaValidationIssue {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
}

/** Non-blocking warning attached to an accepted entry write in shadow mode. */
export interface SchemaShadowWarning {
  code: string
  message: string
  schema?: string
  details?: SchemaValidationIssue[]
}

/** Server-recorded shadow validation failure (metadata + diagnostics only, no entry payload). */
export interface SchemaShadowFailureRecord {
  schemaId: string
  schemaVersion: number
  sessionId: string
  occurredAt: string
  code: string
  message: string
  details: SchemaValidationIssue[]
}

/** Per-version failure summary included in a shadow report. */
export interface SchemaShadowVersionCount {
  version: number
  ref: string
  mode: SchemaVersionMode
  failureCount: number
  lastFailureAt: string | null
}

/** Admin report summarizing shadow failures for one schema or schema version. */
export interface SchemaShadowReport {
  id: string
  version: number | null
  totalFailures: number
  versions: SchemaShadowVersionCount[]
  recentFailures: SchemaShadowFailureRecord[]
  revision: number
}

/** A schema summary paired with all of its immutable versions in ascending order. */
export interface SchemaWithVersions extends SchemaRecord {
  versions: SchemaVersionRecord[]
}

/** Complete snapshot of the schema registry at one revision, used by `pull` and compilation. */
export interface SchemaBundle {
  revision: number
  schemas: SchemaWithVersions[]
}
