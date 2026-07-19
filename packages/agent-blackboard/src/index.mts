/**
 * Public API of `agent-blackboard`: a thin `fetch`-based client for the
 * agent-blackboard HTTP service.
 *
 * - `Sessions` — explicit session lifecycle and parent relationships.
 * - `Entries` — append/read/patch entries using caller-supplied session ids.
 * - `Auth` — admin-only credential management.
 *
 * This module must never import `@aws-sdk/*` or anything from
 * `packages/server` (enforced by `.dependency-cruiser.cjs`).
 */
export { Auth } from './client/auth.mjs'
export type { AuthOptions } from './client/auth.mjs'
export { AgentBlackboardError } from './client/errors.mjs'
export { Entries } from './client/entries.mjs'
export { Sessions } from './client/sessions.mjs'
export type {
  AppendEntryInput,
  ClientConfig,
  CreateSessionInput,
  CredentialCreated,
  CredentialSummary,
  EntryWireFormat,
  GetEntriesQuery,
  GetRawEntriesQuery,
  PatchEntryInput,
  Session,
  SessionEntry,
  StructuredEntryFormat,
} from './client/types.mjs'
