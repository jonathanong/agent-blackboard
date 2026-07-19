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
  createdAt: string
  archivedAt: string | null
}

/** One timestamp-addressed entry belonging to a session. */
export interface SessionEntry {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
}

/** A stored API credential. The raw token is never persisted or returned after creation. */
export interface CredentialRecord {
  id: string
  name: string
  tokenHash: string
  createdAt: string
}
