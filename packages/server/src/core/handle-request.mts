/**
 * Framework-agnostic HTTP core for agent-blackboard. `handleRequest` is the one
 * entrypoint every adapter (Lambda `streamifyResponse` handler, `node:http`
 * `local-server.mts`) calls — it contains all routing/auth/business logic
 * and has zero knowledge of Lambda or Node's HTTP module.
 *
 * REQUEST — `HandlerRequest` (see `core/types.mts`):
 *   - `method`: already upper-cased, e.g. "GET".
 *   - `path`: URL path only, no query string, e.g. "/sessions/s1/entries".
 *   - `query`: parsed query params, `Record<string, string | undefined>`.
 *     Repeated keys: last value wins (adapter's responsibility).
 *   - `headers`: `Record<string, string>`, keys already lower-cased by the
 *     adapter. Multi-valued headers should be joined by the adapter (", ").
 *   - `body`: one of — `undefined` (no body); `string | Uint8Array` (fully
 *     buffered by the adapter); `AsyncIterable<string | Uint8Array>` (a
 *     streamed/chunked body); or an already-JSON-parsed value if the
 *     adapter chose to parse upstream itself. `handleRequest` discriminates
 *     these at runtime (see `core/body.mts`) and buffers/parses per-route
 *     as needed — every current route needs the full body before responding.
 *
 * RESPONSE — `HandlerResponse`:
 *   - `status`, `headers`.
 *   - `body`: ALWAYS an `AsyncIterable<string | Uint8Array>`, even for a
 *     small non-streaming response (a single-chunk generator) — so adapters
 *     can consume every response the same way. In practice every response
 *     produced here yields `string` chunks only.
 *
 * DEPS:
 *   - `store`: a `BlackboardStore` (see `store/store.mts`) — in-memory for
 *     tests/local dev, DynamoDB-backed in production.
 *   - `now`: `() => Date`. Accepted for contract stability with the rest of
 *     the server (and so adapters have one clock-injection point to reach
 *     for), but NOT currently read by any routing logic here — entry
 *     timestamps are the store's responsibility (it owns its own `now`).
 *   - `env`: `{ AGENT_BLACKBOARD_ADMIN_CREDENTIALS?: string }` — passed through to
 *     `resolveAdminCredential` for `/credentials*` routes.
 *
 * ROUTING: unknown paths -> 404. A method not implemented on a known path
 * is also 404 (not 405) — kept simple and documented per-route. Missing or
 * invalid auth -> 401. A credential of the wrong type for the route (e.g. a
 * client token on `/credentials`) is ALSO 401, not 403 — chosen for
 * consistency (one auth-failure status across this API) rather than to hide
 * route existence, since route existence isn't secret here.
 */
import type { AdminEnv } from '../auth/admin.mjs'
import type { BlackboardStore } from '../store/store.mjs'
import { notFoundResponse } from './response.mjs'
import { handleCredentialsRoute } from './routes/credentials.mjs'
import { handleEntriesRoute } from './routes/entries.mjs'
import { handleSessionsRoute } from './routes/sessions.mjs'
import type { HandlerRequest, HandlerResponse } from './types.mjs'

export interface HandleRequestDeps {
  store: BlackboardStore
  now: () => Date
  env: AdminEnv
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

// `request.path` is `url.pathname` (see local-server.mts/handler.mts): the
// WHATWG URL parser preserves percent-encoding in `.pathname` rather than
// decoding it, so a client-side `encodeURIComponent(sessionId)` (needed for
// ids containing e.g. `:`) survives verbatim into a captured route segment.
// Decode it here, once, before it reaches route handlers or the store. A
// malformed escape (e.g. a bare `%`) makes decodeURIComponent throw; treat
// that the same as any other id no route/store will ever match: `null`,
// signalling the caller to 404 rather than let the URIError become a 500.
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export async function handleRequest(
  request: HandlerRequest,
  deps: HandleRequestDeps,
): Promise<HandlerResponse> {
  const path = normalizePath(request.path)
  if (path === '/credentials') return handleCredentialsRoute(request, deps.store, deps.env)
  if (path === '/sessions') return handleSessionsRoute(request, deps.store)
  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(path)
  if (sessionMatch) {
    const sessionId = decodeSegment(sessionMatch[1]!)
    return sessionId === null
      ? notFoundResponse()
      : handleSessionsRoute(request, deps.store, sessionId)
  }
  const entriesMatch = /^\/sessions\/([^/]+)\/entries$/.exec(path)
  if (entriesMatch) {
    const sessionId = decodeSegment(entriesMatch[1]!)
    return sessionId === null
      ? notFoundResponse()
      : handleEntriesRoute(request, deps.store, sessionId)
  }
  return notFoundResponse()
}
