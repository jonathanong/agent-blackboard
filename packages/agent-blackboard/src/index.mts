/**
 * Public API of `agent-blackboard`: a thin `fetch`-based client for the
 * agent-blackboard HTTP service.
 *
 * - `Sessions` — explicit session lifecycle and parent relationships.
 * - `Entries` — append/read entries using caller-supplied session ids.
 * - `Snapshots` — file-backed bulk export with compact verified metadata.
 * - `Auth` — admin-only credential management.
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
