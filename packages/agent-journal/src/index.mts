/**
 * Public API of `@jongleberry/agent-journal`: a thin `fetch`-based client
 * for the agent-journal HTTP service.
 *
 * - `Journal` — append + read, bound to one session + agent.
 * - `Journals` — batch append/read/patch across sessions.
 * - `Auth` — admin-only credential management.
 *
 * This module must never import `@aws-sdk/*` or anything from
 * `packages/server` (enforced by `.dependency-cruiser.cjs`).
 */
export { Auth } from './client/auth.mjs'
export type { AuthOptions } from './client/auth.mjs'
export { AgentJournalError } from './client/errors.mjs'
export { Journal } from './client/journal.mjs'
export type { JournalGetOptions, JournalOptions } from './client/journal.mjs'
export { Journals } from './client/journals.mjs'
export type {
  AppendInput,
  ClientConfig,
  CredentialCreated,
  CredentialSummary,
  GetEntriesQuery,
  GetRawQuery,
  JournalEntry,
  JournalEntryFormat,
  JournalWireFormat,
  PatchOp,
} from './client/types.mjs'
export { resolveSessionId } from './session.mjs'
export type { ResolveSessionIdOptions } from './session.mjs'
