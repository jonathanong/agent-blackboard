import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AppendEntryInput } from '../client/types.mjs'
import { enclosingWorktreeRoot } from '../session-id/persist.mjs'
import { readValidatedRecords, writeJsonAtomic } from './fs.mjs'
import type {
  OutboxPendingRecord,
  OutboxPruneOptions,
  OutboxPruneResult,
  OutboxRejectedRecord,
  OutboxSessionCounts,
  OutboxStatus,
  OutboxTarget,
} from './types.mjs'

export const DEFAULT_OUTBOX_RELATIVE = '.local/agent-blackboard/outbox'
const PENDING_DIR = 'pending'
const REJECTED_DIR = 'rejected'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTarget(value: unknown): boolean {
  if (value === undefined) return true
  return (
    isPlainObject(value) &&
    typeof value.server === 'string' &&
    (value.credentialId === undefined || typeof value.credentialId === 'string')
  )
}

function isPendingRecord(value: unknown): value is OutboxPendingRecord {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.queuedAt === 'string' &&
    typeof value.sessionId === 'string' &&
    isPlainObject(value.data) &&
    typeof value.sourceEventId === 'string' &&
    typeof value.lastError === 'string' &&
    isValidTarget(value.target)
  )
}

function isRejectedRecord(value: unknown): value is OutboxRejectedRecord {
  return (
    isPendingRecord(value) &&
    typeof (value as unknown as Record<string, unknown>).rejectedAt === 'string' &&
    typeof (value as unknown as Record<string, unknown>).error === 'string'
  )
}

/** Resolves the worktree-scoped or overridden local outbox directory. */
export function resolveOutboxDir(
  cwd: string,
  env: NodeJS.ProcessEnv,
  explicitDir?: string,
): string {
  if (explicitDir) return resolve(cwd, explicitDir)
  const envDir = env.AGENT_BLACKBOARD_OUTBOX_DIR?.trim()
  if (envDir) return resolve(cwd, envDir)
  return join(enclosingWorktreeRoot(cwd), DEFAULT_OUTBOX_RELATIVE)
}

/** Appends a failed entry write into `<dir>/pending/` atomically. */
export function enqueueOutboxEntry(
  dir: string,
  input: AppendEntryInput,
  lastError: string,
  now: () => Date = () => new Date(),
  target?: OutboxTarget,
): OutboxPendingRecord {
  const id = randomUUID()
  const timestamp = now()
  const record: OutboxPendingRecord = {
    id,
    queuedAt: timestamp.toISOString(),
    sessionId: input.sessionId,
    data: input.data,
    ...(input.schemaId !== undefined ? { schemaId: input.schemaId } : {}),
    ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
    sourceEventId: input.sourceEventId ?? `outbox-${id}`,
    lastError,
    ...(target !== undefined ? { target } : {}),
  }
  const fileName = `${String(timestamp.getTime()).padStart(15, '0')}-${id}.json`
  writeJsonAtomic(join(dir, PENDING_DIR, fileName), record)
  return record
}

export function readOutboxPending(
  dir: string,
): Array<{ fileName: string; record: OutboxPendingRecord }> {
  return readValidatedRecords(join(dir, PENDING_DIR), isPendingRecord).records
}

export function updatePendingError(
  dir: string,
  fileName: string,
  record: OutboxPendingRecord,
  lastError: string,
): void {
  writeJsonAtomic(join(dir, PENDING_DIR, fileName), { ...record, lastError })
}

export function removePendingRecord(dir: string, fileName: string): void {
  rmSync(join(dir, PENDING_DIR, fileName), { force: true })
}

export function movePendingToRejected(
  dir: string,
  fileName: string,
  record: OutboxPendingRecord,
  rejection: { status?: number; error: string; errorBody?: unknown },
  now: () => Date = () => new Date(),
): OutboxRejectedRecord {
  const rejected: OutboxRejectedRecord = {
    ...record,
    rejectedAt: now().toISOString(),
    ...(rejection.status !== undefined ? { status: rejection.status } : {}),
    error: rejection.error,
    ...(rejection.errorBody !== undefined ? { errorBody: rejection.errorBody } : {}),
  }
  writeJsonAtomic(join(dir, REJECTED_DIR, fileName), rejected)
  removePendingRecord(dir, fileName)
  return rejected
}

function ensureCounts(
  sessions: Record<string, OutboxSessionCounts>,
  sessionId: string,
): OutboxSessionCounts {
  let counts = Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : undefined
  if (!counts) {
    counts = { pending: 0, rejected: 0 }
    Object.defineProperty(sessions, sessionId, {
      value: counts,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return counts
}

/** Summarizes pending and rejected entry counts per session plus rejected error details. */
export function getOutboxStatus(dir: string): OutboxStatus {
  const pending = readValidatedRecords(join(dir, PENDING_DIR), isPendingRecord)
  const rejected = readValidatedRecords(join(dir, REJECTED_DIR), isRejectedRecord)
  const sessions = Object.create(null) as Record<string, OutboxSessionCounts>
  for (const { record } of pending.records) ensureCounts(sessions, record.sessionId).pending += 1
  for (const { record } of rejected.records) ensureCounts(sessions, record.sessionId).rejected += 1
  const corruptFiles = [...pending.corruptFiles, ...rejected.corruptFiles]
  return {
    dir,
    pending: pending.records.length,
    rejected: rejected.records.length,
    sessions,
    rejectedRecords: rejected.records.map(({ record }) => record),
    ...(corruptFiles.length > 0 ? { corruptFiles } : {}),
  }
}

/** Removes matching rejected records from `<dir>/rejected/`. */
export function pruneOutboxRejected(
  dir: string,
  options: Pick<OutboxPruneOptions, 'id' | 'sessionId'> = {},
): OutboxPruneResult {
  const rejected = readValidatedRecords(join(dir, REJECTED_DIR), isRejectedRecord).records
  let removed = 0
  for (const { fileName, record } of rejected) {
    const matchesId = options.id === undefined || record.id === options.id
    const matchesSession = options.sessionId === undefined || record.sessionId === options.sessionId
    if (matchesId && matchesSession) {
      rmSync(join(dir, REJECTED_DIR, fileName), { force: true })
      removed += 1
    }
  }
  return { dir, removed, remainingRejected: rejected.length - removed }
}
