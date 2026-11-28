import { cleanupSnapshotPartitions } from '../client/snapshot-partition-cleanup.mjs'
import { partitionSnapshot } from '../client/snapshot-partitions.mjs'
import { Snapshots } from '../client/snapshots.mjs'
import {
  expectObject,
  nullableString,
  optionalPositiveInt,
  optionalPositiveNumber,
  requiredString,
} from './validate.mjs'
import type {
  SnapshotCounts,
  SnapshotPartitionResult,
  SnapshotSelection,
} from '../client/snapshot-types.mjs'
import type { ClientConfig } from '../client/types.mjs'

function parentSessionId(value: unknown): string | null {
  const id = nullableString(value, 'parentSessionId')
  if (id !== null && !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error('"parentSessionId" is invalid.')
  }
  return id
}

function dataArrayContains(value: unknown): Record<string, string> {
  const object = expectObject(value, 'dataArrayContains')
  if (
    Object.keys(object).length === 0 ||
    Object.entries(object).some(
      ([key, item]) => key.length === 0 || typeof item !== 'string' || item.length === 0,
    )
  ) {
    throw new Error('"dataArrayContains" must contain only string values.')
  }
  return object as Record<string, string>
}

function selectionFrom(args: Record<string, unknown>): SnapshotSelection {
  const hasParent = Object.hasOwn(args, 'parentSessionId')
  return {
    ...(args.agent === undefined ? {} : { agent: requiredString(args.agent, 'agent') }),
    ...(args.version === undefined ? {} : { version: requiredString(args.version, 'version') }),
    ...(hasParent ? { parentSessionId: parentSessionId(args.parentSessionId) } : {}),
    ...(args.data === undefined ? {} : { data: expectObject(args.data, 'data') }),
    ...(args.dataArrayContains === undefined
      ? {}
      : { dataArrayContains: dataArrayContains(args.dataArrayContains) }),
    ...(args.inactiveForHours === undefined
      ? {}
      : { inactiveForHours: optionalPositiveNumber(args.inactiveForHours, 'inactiveForHours')! }),
  }
}

function nonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`"${field}" must be a non-negative integer.`)
  }
  return value
}

function optionalCounts(value: unknown): SnapshotCounts | undefined {
  if (value === undefined) return undefined
  const counts = expectObject(value, 'counts')
  return {
    sessions: nonNegativeInt(counts.sessions, 'counts.sessions'),
    entries: nonNegativeInt(counts.entries, 'counts.entries'),
    records: nonNegativeInt(counts.records, 'counts.records'),
    bytes: nonNegativeInt(counts.bytes, 'counts.bytes'),
  }
}

/** Exports a local JSONL evidence file; never returns the snapshot records through MCP. */
export function handleSnapshotExport(
  args: Record<string, unknown>,
  config: ClientConfig,
): ReturnType<Snapshots['export']> {
  const path = args.path === undefined ? undefined : requiredString(args.path, 'path')
  return new Snapshots(config).export({
    ...(path === undefined ? {} : { path }),
    selection: selectionFrom(args),
  })
}

/** Splits a generated temporary snapshot into bounded read-only partitions with ownership checks. */
export function handleSnapshotPartition(
  args: Record<string, unknown>,
): Promise<SnapshotPartitionResult> {
  const path = requiredString(args.path, 'path')
  const cleanupToken = requiredString(args.cleanupToken, 'cleanupToken')
  const maxSessions = optionalPositiveInt(args.maxSessions, 'maxSessions')
  const maxBytes = optionalPositiveInt(args.maxBytes, 'maxBytes')
  const checksum =
    args.checksum === undefined ? undefined : requiredString(args.checksum, 'checksum')
  if (checksum !== undefined && !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error('"checksum" must be a SHA-256 hex digest.')
  }
  const counts = optionalCounts(args.counts)
  return partitionSnapshot({
    path,
    cleanupToken,
    ...(maxSessions === undefined ? {} : { maxSessions }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(checksum === undefined ? {} : { checksum: { algorithm: 'sha256', value: checksum } }),
    ...(counts === undefined ? {} : { counts }),
  })
}

/** Cleans up generated temporary snapshot files and/or partition directories with ownership checks. */
export async function handleSnapshotCleanup(
  args: Record<string, unknown>,
): Promise<{ removed: true }> {
  const path = args.path === undefined ? undefined : requiredString(args.path, 'path')
  const directory =
    args.directory === undefined ? undefined : requiredString(args.directory, 'directory')
  if (!path && !directory) {
    throw new Error('"snapshot_cleanup" requires "path" or "directory".')
  }
  const cleanupToken = requiredString(args.cleanupToken, 'cleanupToken')
  await cleanupSnapshotPartitions({
    ...(path === undefined ? {} : { path }),
    ...(directory === undefined ? {} : { directory }),
    cleanupToken,
  })
  return { removed: true }
}
