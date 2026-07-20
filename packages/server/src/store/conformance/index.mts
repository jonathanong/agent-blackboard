import type { BlackboardStore } from '../store.mjs'
import { runCredentialsConformance } from './credentials.mjs'
import { runEntriesConformance } from './entries.mjs'
import { runSessionLifecycleConformance } from './session-lifecycle.mjs'
import { runSessionsConformance } from './sessions.mjs'

/**
 * Runs the full behavioral contract shared by every `BlackboardStore`
 * implementation. `makeStore` is a sync, zero-arg factory called fresh
 * inside each `it()` — `MemoryBlackboardStore` needs per-test isolation,
 * while the Dynamo store just cheaply rewires against an already-provisioned
 * shared table.
 *
 * `ttl` is intentionally out of scope here: it's a DynamoDB storage-internal
 * attribute, not part of `Session`/`SessionEntry`, and gets dedicated
 * Dynamo-only tests in a later workstream.
 */
export function runStoreConformance(makeStore: () => BlackboardStore): void {
  runSessionsConformance(makeStore)
  runSessionLifecycleConformance(makeStore)
  runEntriesConformance(makeStore)
  runCredentialsConformance(makeStore)
}
