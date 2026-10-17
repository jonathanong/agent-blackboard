import type { HarnessId } from './harness.mjs'
import {
  persistRealSessionId,
  resolveAndPersistSessionStartId,
  type PersistedHarness,
} from './persist.mjs'
import { sanitizeSessionId } from './valid-id.mjs'

/** A harness hook's JSON payload. Only its session-id keys are read. */
export type HookPayload = Readonly<Record<string, unknown>>

type Env = Readonly<Record<string, string | undefined>>

/** The first key in `keys` holding a valid session id, or `''`. */
export function hookPayloadSessionId(
  payload: HookPayload,
  keys: readonly string[] = ['session_id', 'sessionId'],
): string {
  for (const key of keys) {
    const id = sanitizeSessionId(payload[key])
    if (id !== '') return id
  }
  return ''
}

export function cursorPayloadSessionId(payload: HookPayload): string {
  return hookPayloadSessionId(payload, ['session_id', 'sessionId', 'conversation_id'])
}

export function grokHookSessionId(payload: HookPayload, env: Env): string {
  return sanitizeSessionId(env.GROK_SESSION_ID) || hookPayloadSessionId(payload)
}

// Claude and Codex expose their session id to every process through env, so only the
// Claude-compat runtimes without one (Grok and Cursor) persist it for later hook-less readers.
function hookRuntimeSessionId(
  runtime: HarnessId | undefined,
  payload: HookPayload,
  env: Env,
): { harness: Extract<PersistedHarness, 'cursor' | 'grok'>; sessionId: string } | undefined {
  if (runtime === 'grok') return { harness: 'grok', sessionId: grokHookSessionId(payload, env) }
  if (runtime === 'cursor') return { harness: 'cursor', sessionId: cursorPayloadSessionId(payload) }
  return undefined
}

/** SessionStart hook: persists (or generates) the Cursor/Grok id. No-op for other runtimes. */
export function persistHookSessionStart(
  runtime: HarnessId | undefined,
  payload: HookPayload,
  env: Env,
  root: string,
  generateId?: () => string,
): { generated: boolean; sessionId: string } | undefined {
  const hook = hookRuntimeSessionId(runtime, payload, env)
  if (hook === undefined) return undefined
  return resolveAndPersistSessionStartId({
    harness: hook.harness,
    root,
    generateId,
    payloadId: hook.sessionId,
  })
}

/** Later hooks: refreshes the persisted Cursor/Grok id when the payload carries a real one. */
export function persistHookRealSessionId(
  runtime: HarnessId | undefined,
  payload: HookPayload,
  env: Env,
  root: string,
): void {
  const hook = hookRuntimeSessionId(runtime, payload, env)
  if (hook !== undefined) persistRealSessionId(root, hook.harness, hook.sessionId)
}
