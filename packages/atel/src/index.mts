/**
 * Public API of `@jongleberry/atel`: a thin `fetch`-based client for the
 * atel HTTP service.
 *
 * - `Telemetry` — append + read, bound to one session + agent.
 * - `Telemetries` — batch append/read/patch across sessions.
 * - `Auth` — admin-only credential management.
 *
 * This module must never import `@aws-sdk/*` or anything from
 * `packages/server` (enforced by `.dependency-cruiser.cjs`).
 */
export { Auth } from './client/auth.mjs'
export type { AuthOptions } from './client/auth.mjs'
export { AtelError } from './client/errors.mjs'
export { Telemetry } from './client/journal.mjs'
export type { TelemetryGetOptions, TelemetryOptions } from './client/journal.mjs'
export { Telemetries } from './client/journals.mjs'
export type {
  AppendInput,
  ClientConfig,
  CredentialCreated,
  CredentialSummary,
  GetEntriesQuery,
  GetRawQuery,
  PatchOp,
  TelemetryEntry,
  TelemetryEntryFormat,
  TelemetryWireFormat,
} from './client/types.mjs'
export { resolveSessionId } from './session.mjs'
export type { ResolveSessionIdOptions } from './session.mjs'
