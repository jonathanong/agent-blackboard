/**
 * Public API of `agent-blackboard`: a thin `fetch`-based client for the
 * agent-blackboard HTTP service.
 *
 * - `Sessions` — explicit session lifecycle and parent relationships.
 * - `Entries` — append/read entries using caller-supplied session ids.
 * - `Snapshots` — file-backed bulk export with compact verified metadata.
 * - `Auth` — admin-only credential management.
 * - Session-id resolution — harness detection, per-worktree persistence, and root Codex ids for
 *   callers that omit an explicit session id. Every function takes `env`/`cwd` explicitly.
 *
 * This module must never import `@aws-sdk/*` or anything from
 * `packages/server` (enforced by `.dependency-cruiser.cjs`).
 */
export { Auth } from './client/auth.mjs'
export type { AuthOptions } from './client/auth.mjs'
export { AgentBlackboardError } from './client/errors.mjs'
export { Entries } from './client/entries.mjs'
export { formatError } from './format-error.mjs'
export { Sessions } from './client/sessions.mjs'
export { Snapshots } from './client/snapshots.mjs'
export { cleanupSnapshotPartitions } from './client/snapshot-partition-cleanup.mjs'
export { partitionSnapshot } from './client/snapshot-partitions.mjs'
export {
  HARNESS_IDS,
  HARNESS_SESSION_PRECEDENCE,
  inspectHarnessEnvironment,
  selectHarnessSession,
  transcriptPathHarness,
} from './session-id/harness.mjs'
export type {
  HarnessEnvironment,
  HarnessId,
  HarnessSessionIdentity,
} from './session-id/harness.mjs'
export {
  cursorPayloadSessionId,
  grokHookSessionId,
  hookPayloadSessionId,
  persistHookRealSessionId,
  persistHookSessionStart,
} from './session-id/hook-payload.mjs'
export type { HookPayload } from './session-id/hook-payload.mjs'
export {
  SESSION_PERSIST_RELATIVE,
  enclosingWorktreeRoot,
  persistRealSessionId,
  readPersistedSessionId,
  resolveAndPersistRootCodexSessionId,
  resolveAndPersistSessionStartId,
  sessionPersistPath,
} from './session-id/persist.mjs'
export type { PersistedHarness } from './session-id/persist.mjs'
export {
  agentForHarness,
  requireSessionAgent,
  requireSessionId,
  requireSessionIdentity,
  resolveSessionId,
  resolveSessionIdentity,
} from './session-id/resolve.mjs'
export type {
  ResolveSessionIdentityOptions,
  SessionAgent,
  SessionIdentity,
} from './session-id/resolve.mjs'
export { validateRootCodexOptions } from './session-id/root-codex-options.mjs'
export type { RootCodexOptions } from './session-id/root-codex-options.mjs'
export { isValidSessionId, sanitizeSessionId } from './session-id/valid-id.mjs'
export type {
  AppendEntryInput,
  ClientConfig,
  CreateSessionInput,
  CredentialCreated,
  CredentialSummary,
  EntryWireFormat,
  GetEntriesQuery,
  GetRawEntriesQuery,
  ListSessionsQuery,
  PatchSessionInput,
  ReadRetryOptions,
  Session,
  SessionEntry,
  StructuredEntryFormat,
  SnapshotCounts,
  SnapshotExportOptions,
  SnapshotExportResult,
  SnapshotChecksum,
  SnapshotCleanupOptions,
  SnapshotManifest,
  SnapshotPartition,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
  SnapshotSelection,
  SnapshotVerification,
} from './client/types.mjs'
