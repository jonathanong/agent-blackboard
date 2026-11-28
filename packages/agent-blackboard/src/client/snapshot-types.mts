/** Exact filters accepted by the immutable bulk snapshot endpoint. */
export interface SnapshotSelection {
  agent?: string
  version?: string
  parentSessionId?: string | null
  data?: Record<string, unknown>
  dataArrayContains?: Record<string, string>
  inactiveForHours?: number
}

export interface SnapshotCounts {
  sessions: number
  entries: number
  records: number
  bytes: number
}

/** Terminal record emitted by a completed `GET /snapshot` export. */
export interface SnapshotManifest {
  schemaVersion: 1
  status: 'complete'
  createdAt: string
  completedAt: string
  selection: SnapshotSelection & { archived: false }
  counts: Omit<SnapshotCounts, 'bytes'>
  ordering: { sessions: 'createdAt ascending'; entries: 'createdAt ascending within session' }
  consistency: 'best-effort'
}

export interface SnapshotExportOptions {
  /** New absolute destination; omitted creates a private file under the system temp directory. */
  path?: string
  selection?: SnapshotSelection
}

export interface SnapshotExportResult {
  path: string
  counts: SnapshotCounts
  checksum: SnapshotChecksum
  manifest: SnapshotManifest
  /** Capability required to partition or clean up an export created by the client. */
  cleanupToken?: string | undefined
}

export interface SnapshotChecksum {
  algorithm: 'sha256'
  value: string
}

/** Verification metadata returned by `Snapshots.export` and accepted by `partition`. */
export interface SnapshotVerification {
  checksum?: SnapshotChecksum
  counts?: SnapshotCounts
}

export interface SnapshotPartitionOptions extends SnapshotVerification {
  /** A generated temporary snapshot returned by `Snapshots.export` without `path`. */
  path: string
  /** Capability returned by the generated snapshot export. */
  cleanupToken?: string | undefined
  /** Maximum whole sessions in one partition. Defaults to 25. */
  maxSessions?: number
  /** Maximum bytes in one partition. Defaults to 1 MiB. */
  maxBytes?: number
}

export interface SnapshotPartition {
  path: string
  counts: SnapshotCounts
  checksum: SnapshotChecksum
  manifest: SnapshotManifest
}

export interface SnapshotPartitionResult {
  directory: string
  partitions: SnapshotPartition[]
  /** Capability required to clean up this generated partition directory. */
  cleanupToken: string
}

export interface SnapshotCleanupOptions {
  /** A generated temporary snapshot returned by `Snapshots.export` without `path`. */
  path?: string
  /** A generated temporary partition directory returned by `Snapshots.partition`. */
  directory?: string
  /** Capability returned by the generated snapshot export/partition. */
  cleanupToken?: string | undefined
}
