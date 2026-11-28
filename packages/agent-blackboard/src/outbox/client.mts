import { sendAppendEntry } from '../client/append.mjs'
import type { ClientConfig } from '../client/types.mjs'
import { formatError } from '../format-error.mjs'
import { isPermanentRejection } from './classify.mjs'
import {
  getOutboxStatus,
  movePendingToRejected,
  pruneOutboxRejected,
  readOutboxPending,
  removePendingRecord,
  resolveOutboxDir,
  updatePendingError,
} from './store.mjs'
import { matchesOutboxTarget, outboxTargetFromConfig } from './target.mjs'
import type {
  OutboxFlushOptions,
  OutboxFlushResult,
  OutboxLocationOptions,
  OutboxPruneOptions,
  OutboxPruneResult,
  OutboxStatus,
} from './types.mjs'

function targetDir(config: ClientConfig, options: OutboxLocationOptions = {}): string {
  const explicitDir = options.dir ?? config.outboxDir
  return resolveOutboxDir(options.cwd ?? process.cwd(), options.env ?? {}, explicitDir)
}

/** Delivers pending entries from `dir`, moving permanent 4xx rejections aside so they do not block. */
export async function flushOutbox(
  config: ClientConfig,
  dir: string,
  options: Pick<OutboxFlushOptions, 'sessionId'> = {},
): Promise<OutboxFlushResult> {
  const allPending = readOutboxPending(dir)
  const items =
    options.sessionId === undefined
      ? allPending
      : allPending.filter(({ record }) => record.sessionId === options.sessionId)
  const currentTarget = outboxTargetFromConfig(config)
  let delivered = 0
  let duplicates = 0
  let rejected = 0
  let skipped = 0
  let remaining = 0

  for (let index = 0; index < items.length; index += 1) {
    const { fileName, record } = items[index]!
    if (!matchesOutboxTarget(record.target, currentTarget)) {
      skipped += 1
      continue
    }
    try {
      const result = await sendAppendEntry(config, {
        sessionId: record.sessionId,
        data: record.data,
        ...(record.schemaId !== undefined ? { schemaId: record.schemaId } : {}),
        ...(record.schemaVersion !== undefined ? { schemaVersion: record.schemaVersion } : {}),
        sourceEventId: record.sourceEventId,
      })
      removePendingRecord(dir, fileName)
      delivered += 1
      if (result.duplicate) duplicates += 1
    } catch (error) {
      if (isPermanentRejection(error)) {
        movePendingToRejected(dir, fileName, record, {
          status: error.status,
          error: formatError(error),
          errorBody: error.body,
        })
        rejected += 1
        continue
      }
      updatePendingError(dir, fileName, record, formatError(error))
      remaining = skipped + (items.length - index)
      return {
        dir,
        delivered,
        duplicates,
        rejected,
        ...(skipped > 0 ? { skipped } : {}),
        remaining,
      }
    }
  }
  remaining = skipped
  return {
    dir,
    delivered,
    duplicates,
    rejected,
    ...(skipped > 0 ? { skipped } : {}),
    remaining,
  }
}

export class Outbox {
  readonly #config: ClientConfig

  constructor(config: ClientConfig) {
    this.#config = config
  }

  status(options: OutboxLocationOptions = {}): OutboxStatus {
    return getOutboxStatus(targetDir(this.#config, options))
  }

  flush(options: OutboxFlushOptions = {}): Promise<OutboxFlushResult> {
    return flushOutbox(
      this.#config,
      targetDir(this.#config, options),
      options.sessionId !== undefined ? { sessionId: options.sessionId } : {},
    )
  }

  pruneRejected(options: OutboxPruneOptions = {}): OutboxPruneResult {
    return pruneOutboxRejected(targetDir(this.#config, options), {
      ...(options.id !== undefined ? { id: options.id } : {}),
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    })
  }
}
