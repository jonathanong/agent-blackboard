import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AppendEntryInput } from '../client/types.mjs'
import { enclosingWorktreeRoot } from '../session-id/persist.mjs'
import type {
  OutboxPendingRecord,
  OutboxPruneOptions,
  OutboxPruneResult,
  OutboxRejectedRecord,
  OutboxSessionCounts,
  OutboxStatus,
} from './types.mjs'

export const DEFAULT_OUTBOX_RELATIVE = '.local/agent-blackboard/outbox'
const PENDING_DIR = 'pending'
const REJECTED_DIR = 'rejected'

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

function writeJsonAtomic(targetPath: string, payload: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 })
  const temp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temp, targetPath)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function listJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}

function readRecords<T>(dir: string): Array<{ fileName: string; record: T }> {
  const results: Array<{ fileName: string; record: T }> = []
  for (const fileName of listJsonFiles(dir)) {
    const raw = readFileSync(join(dir, fileName), 'utf8')
    results.push({ fileName, record: JSON.parse(raw) as T })
  }
  return results
}

/** Appends a failed entry write into `<dir>/pending/` atomically. */
export function enqueueOutboxEntry(
  dir: string,
  input: AppendEntryInput,
  lastError: string,
  now: () => Date = () => new Date(),
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
  }
  const fileName = `${String(timestamp.getTime()).padStart(15, '0')}-${id}.json`
  writeJsonAtomic(join(dir, PENDING_DIR, fileName), record)
  return record
}

export function readOutboxPending(
  dir: string,
): Array<{ fileName: string; record: OutboxPendingRecord }> {
  return readRecords<OutboxPendingRecord>(join(dir, PENDING_DIR))
}

function readOutboxRejected(
  dir: string,
): Array<{ fileName: string; record: OutboxRejectedRecord }> {
  return readRecords<OutboxRejectedRecord>(join(dir, REJECTED_DIR))
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
  let counts = sessions[sessionId]
  if (!counts) {
    counts = { pending: 0, rejected: 0 }
    sessions[sessionId] = counts
  }
  return counts
}

/** Summarizes pending and rejected entry counts per session plus rejected error details. */
export function getOutboxStatus(dir: string): OutboxStatus {
  const pending = readOutboxPending(dir)
  const rejected = readOutboxRejected(dir)
  const sessions: Record<string, OutboxSessionCounts> = {}
  for (const { record } of pending) ensureCounts(sessions, record.sessionId).pending += 1
  for (const { record } of rejected) ensureCounts(sessions, record.sessionId).rejected += 1
  return {
    dir,
    pending: pending.length,
    rejected: rejected.length,
    sessions,
    rejectedRecords: rejected.map(({ record }) => record),
  }
}

/** Removes matching rejected records from `<dir>/rejected/`. */
export function pruneOutboxRejected(
  dir: string,
  options: Pick<OutboxPruneOptions, 'id' | 'sessionId'> = {},
): OutboxPruneResult {
  const rejected = readOutboxRejected(dir)
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
