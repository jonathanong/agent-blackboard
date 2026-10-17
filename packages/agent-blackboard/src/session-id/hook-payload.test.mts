import { describe, expect, it } from 'vitest'
import { useTempDirs } from '../__tests__/temp-worktree.mjs'
import {
  cursorPayloadSessionId,
  grokHookSessionId,
  hookPayloadSessionId,
  persistHookRealSessionId,
  persistHookSessionStart,
} from './hook-payload.mjs'
import { readPersistedSessionId } from './persist.mjs'

const tempDir = useTempDirs()

describe('hook payload session ids', () => {
  it('reads session_id then sessionId, sanitizing each', () => {
    expect(hookPayloadSessionId({ session_id: ' a ', sessionId: 'b' })).toBe('a')
    expect(hookPayloadSessionId({ session_id: '../x', sessionId: 'b' })).toBe('b')
    expect(hookPayloadSessionId({ session_id: 1 })).toBe('')
  })

  it('lets Cursor fall back to conversation_id', () => {
    expect(cursorPayloadSessionId({ conversation_id: 'conv-1', session_id: ' sess-1 ' })).toBe(
      'sess-1',
    )
    expect(cursorPayloadSessionId({ conversation_id: 'conv-1' })).toBe('conv-1')
    expect(cursorPayloadSessionId({ session_id: '../etc/passwd' })).toBe('')
  })

  it('prefers GROK_SESSION_ID over the Grok payload', () => {
    expect(grokHookSessionId({ sessionId: 'payload' }, { GROK_SESSION_ID: 'env' })).toBe('env')
    expect(grokHookSessionId({ sessionId: 'payload' }, { GROK_SESSION_ID: '../x' })).toBe('payload')
  })
})

describe('hook runtime persist', () => {
  it.each(['claude', 'codex', undefined] as const)('is a no-op for runtime %s', async (runtime) => {
    const root = await tempDir()
    const payload = { sessionId: 'payload-id' }
    const env = { GROK_SESSION_ID: 'grok-env' }
    expect(persistHookSessionStart(runtime, payload, env, root)).toBeUndefined()
    persistHookRealSessionId(runtime, payload, env, root)
    expect(readPersistedSessionId(root, 'cursor')).toBeUndefined()
    expect(readPersistedSessionId(root, 'grok')).toBeUndefined()
  })

  it.each([
    ['grok', 'grok-generated'],
    ['cursor', 'cursor-generated'],
  ] as const)('%s SessionStart generates when no payload id exists', async (runtime, id) => {
    const root = await tempDir()
    expect(persistHookSessionStart(runtime, {}, {}, root, () => id)).toEqual({
      generated: true,
      sessionId: id,
    })
    expect(readPersistedSessionId(root, runtime)).toBe(id)
  })

  it('Grok SessionStart persists a real id and later hooks never generate', async () => {
    const root = await tempDir()
    expect(persistHookSessionStart('grok', { sessionId: 'grok-real' }, {}, root)).toEqual({
      generated: false,
      sessionId: 'grok-real',
    })
    persistHookRealSessionId('grok', {}, { GROK_SESSION_ID: 'grok-env' }, root)
    expect(readPersistedSessionId(root, 'grok')).toBe('grok-env')
    persistHookRealSessionId('grok', {}, {}, root)
    expect(readPersistedSessionId(root, 'grok')).toBe('grok-env')
  })

  it('Cursor SessionStart persists session_id and later hooks fall back to conversation_id', async () => {
    const root = await tempDir()
    expect(persistHookSessionStart('cursor', { session_id: 'cursor-real' }, {}, root)).toEqual({
      generated: false,
      sessionId: 'cursor-real',
    })
    persistHookRealSessionId('cursor', { conversation_id: 'cursor-conv' }, {}, root)
    expect(readPersistedSessionId(root, 'cursor')).toBe('cursor-conv')
    persistHookRealSessionId('cursor', {}, {}, root)
    expect(readPersistedSessionId(root, 'cursor')).toBe('cursor-conv')
  })
})
