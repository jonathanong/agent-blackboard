/**
 * Shared wire types for the atel HTTP client.
 *
 * These mirror the server's documented contract (see the plan doc / server
 * `packages/server/src/core/handle-request.mts`) but are intentionally
 * decoupled from it — this package must never import from `packages/server`.
 */

/** Config needed to reach the server: a base URL and a bearer token. */
export interface ClientConfig {
  baseUrl: string
  token: string
}

/** A single telemetry entry as returned by the server. */
export interface TelemetryEntry {
  id: string
  sessionId: string
  agent: string
  createdAt: string
  archived: boolean
  data: Record<string, unknown>
}

/** Body accepted by `POST /telemetry` for a single entry. */
export interface AppendInput {
  sessionId: string
  agent: string
  data: Record<string, unknown>
}

/**
 * Wire format for `GET /telemetry`. `'markdown'` is only meaningful for raw
 * (unparsed) reads — see `client/stream.mts` for why entry-returning reads
 * are restricted to `'json' | 'jsonl'`.
 */
export type TelemetryWireFormat = 'json' | 'jsonl' | 'markdown'

/** Format restricted to values that parse into structured entries. */
export type TelemetryEntryFormat = Extract<TelemetryWireFormat, 'json' | 'jsonl'>

/** Query params accepted by `GET /telemetry` when reading parsed entries. */
export interface GetEntriesQuery {
  sessionId?: string
  agent?: string
  archived?: boolean
  format?: TelemetryEntryFormat
}

/** Query params accepted by `GET /telemetry` for a raw (unparsed) read. */
export interface GetRawQuery {
  sessionId?: string
  agent?: string
  archived?: boolean
  format?: TelemetryWireFormat
}

/** One patch operation accepted by `PATCH /telemetry`. `data` is a shallow merge. */
export interface PatchOp {
  id: string
  archived?: boolean
  data?: Record<string, unknown>
}

/** A telemetry or admin credential, as listed by `GET /credentials`. */
export interface CredentialSummary {
  id: string
  name: string
  createdAt: string
}

/** The one-time response from `POST /credentials`, including the secret token. */
export interface CredentialCreated extends CredentialSummary {
  token: string
}
