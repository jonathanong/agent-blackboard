import type { BlackboardStore } from '../store.mjs'
import { runCredentialsConformance } from './credentials.mjs'
import { runEntriesConformance } from './entries.mjs'
import { runRetentionConformance, type ConformanceRetentionOptions } from './retention.mjs'
import { runSchemasConformance } from './schemas.mjs'
import { runSessionLifecycleConformance } from './session-lifecycle.mjs'
import { runSessionPaginationConformance } from './session-pagination.mjs'
import { runSessionsConformance } from './sessions.mjs'

export type { ConformanceRetentionOptions } from './retention.mjs'

/**
 * Runs the full behavioral contract shared by every `BlackboardStore`
 * implementation. `makeStore` is a sync factory called fresh inside each `it()`
 * — `MemoryBlackboardStore` needs per-test isolation, while the Dynamo store
 * cheaply rewires against an already-provisioned shared table.
 */
export function runStoreConformance(
  makeStore: (options?: ConformanceRetentionOptions) => BlackboardStore,
): void {
  runSessionsConformance(() => makeStore())
  runSessionPaginationConformance(() => makeStore())
  runSessionLifecycleConformance(() => makeStore())
  runEntriesConformance(() => makeStore())
  runRetentionConformance(makeStore)
  runCredentialsConformance(() => makeStore())
  runSchemasConformance(() => makeStore())
}
