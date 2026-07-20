import { expect } from 'vitest'
import type { Session } from '../../core/types.mjs'
import type { BlackboardStore } from '../store.mjs'

export const AGENT = { agent: 'conformance-agent', version: '1.0.0' }

/**
 * Buffers a store's async-iterable result into an array. Conformance
 * fixtures are small, so buffering here is fine even though `BlackboardStore`
 * itself must stream (`getEntries` implementations must not load a full
 * session into memory before yielding the first entry). `listSessions` is a
 * single-page `Promise<ListSessionsResult>`, not an async iterable — see
 * `runSessionPaginationConformance` in `session-pagination.mts` instead.
 */
export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

/**
 * Asserts `value` is a non-null, ISO-parseable timestamp string without
 * pinning an exact value. Memory-store tests can inject a fake clock, but
 * the Dynamo integration harness runs against the real system clock, so
 * exact timestamps aren't assertable identically across both backends here.
 */
export function expectValidTimestamp(value: unknown): void {
  expect(typeof value).toBe('string')
  expect(Number.isNaN(Date.parse(value as string))).toBe(false)
}

export function createTestSession(
  store: BlackboardStore,
  credId: string,
  id: string,
  parentSessionId: string | null,
): Promise<Session> {
  return store.createSession({ credId, id, parentSessionId, ...AGENT })
}
