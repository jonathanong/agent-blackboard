import type { AdminEnv } from './auth/admin.mjs'
import type { BodyChunk, HandlerRequest, HandlerResponse } from './core/types.mjs'
import type { BlackboardStore } from './store/store.mjs'
import type {
  HandleDeps,
  LambdaContext,
  LambdaFunctionUrlEvent,
  ResponseStreamSink,
  WritableSink,
} from './handler.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// handler.mts touches the ambient `awslambda` global at module-evaluation
// time (the top-level `export const handler = awslambda.streamifyResponse(
// ...)` binding), so it must be polyfilled before the module is loaded.
// Using a dynamic import (after the polyfill is installed) instead of a
// static one keeps ordering correct — static imports are hoisted above any
// other top-level statement in this file.
;(globalThis as { awslambda?: unknown }).awslambda = {
  streamifyResponse: (fn: unknown) => fn,
  HttpResponseStream: { from: (stream: unknown) => stream },
}

const {
  parseFunctionUrlEvent,
  streamResponseBody,
  handle,
  nodeStreamSink,
  realStore,
  adminEnv,
  currentTime,
  handler,
} = await import('./handler.mjs')

// Never actually invoked in these tests — `handle()` only threads `store`
// through to the (faked) `handleRequest`, it never touches it directly.
const fakeStore = {} as BlackboardStore

function baseEvent(overrides: Partial<LambdaFunctionUrlEvent> = {}): LambdaFunctionUrlEvent {
  return {
    requestContext: { http: { method: 'GET', path: '/sessions/s1/entries' } },
    headers: {},
    queryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    ...overrides,
  }
}

async function* chunkOf(text: string): AsyncIterable<BodyChunk> {
  yield text
}

/** An async-iterable that rejects on its first `next()` — simulates a body that fails before yielding anything. */
function throwingBody(message: string): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<string>> => Promise.reject(new Error(message)),
    }),
  }
}

function recordingSink(): ResponseStreamSink & {
  writes: BodyChunk[]
  ended: boolean
  destroyedWith?: Error | undefined
} {
  const writes: BodyChunk[] = []
  return {
    writes,
    ended: false,
    destroyedWith: undefined,
    async write(chunk) {
      writes.push(chunk)
    },
    async end() {
      this.ended = true
    },
    destroy(error) {
      this.destroyedWith = error
    },
  }
}

function fakeWritable(fail = false) {
  const written: unknown[] = []
  let ended = false
  let destroyedWith: Error | undefined
  const stream = {
    written,
    isEnded: () => ended,
    destroyedWith: () => destroyedWith,
    write: (chunk: unknown, cb: (error?: Error) => void) => {
      written.push(chunk)
      cb(fail ? new Error('write failed') : undefined)
      return true
    },
    end: (cb: () => void) => {
      ended = true
      cb()
    },
    destroy: (error?: Error) => {
      destroyedWith = error
    },
  }
  return stream as unknown as WritableSink & {
    written: unknown[]
    isEnded: () => boolean
    destroyedWith: () => Error | undefined
  }
}

describe('parseFunctionUrlEvent', () => {
  it('prefers rawPath, lowercases headers, and parses query params', () => {
    const request = parseFunctionUrlEvent(
      baseEvent({
        rawPath: '/sessions/s1/entries',
        requestContext: { http: { method: 'GET', path: '/ignored' } },
        headers: { 'Content-Type': 'application/json', 'X-Token': 'abc' },
        queryStringParameters: { sessionId: 's1', archived: 'false' },
      }),
    )
    expect(request.path).toBe('/sessions/s1/entries')
    expect(request.headers).toEqual({ 'content-type': 'application/json', 'x-token': 'abc' })
    expect(request.query).toEqual({ sessionId: 's1', archived: 'false' })
  })

  it('falls back to requestContext.http.path when rawPath is absent', () => {
    const request = parseFunctionUrlEvent(
      baseEvent({ requestContext: { http: { method: 'POST', path: '/sessions/s1/entries' } } }),
    )
    expect(request.path).toBe('/sessions/s1/entries')
    expect(request.method).toBe('POST')
  })

  it('treats a missing/null/empty body as undefined', () => {
    expect(parseFunctionUrlEvent(baseEvent({ body: null })).body).toBeUndefined()
    expect(parseFunctionUrlEvent(baseEvent({ body: '' })).body).toBeUndefined()
  })

  it('passes a plain-text body through untouched', () => {
    expect(parseFunctionUrlEvent(baseEvent({ body: '{"note":"hi"}' })).body).toBe('{"note":"hi"}')
  })

  it('defaults isBase64Encoded to false when the event omits the key entirely', () => {
    const event: LambdaFunctionUrlEvent = {
      requestContext: { http: { method: 'GET', path: '/sessions/s1/entries' } },
      headers: {},
      queryStringParameters: null,
      body: 'plain',
    }
    expect(parseFunctionUrlEvent(event).body).toBe('plain')
  })

  it('base64-decodes the body when isBase64Encoded is set', () => {
    const encoded = Buffer.from('{"note":"hi"}', 'utf8').toString('base64')
    const request = parseFunctionUrlEvent(baseEvent({ body: encoded, isBase64Encoded: true }))
    expect(request.body).toBe('{"note":"hi"}')
  })

  it('defaults query params and headers when absent', () => {
    const request = parseFunctionUrlEvent(baseEvent({ headers: null, queryStringParameters: null }))
    expect(request.headers).toEqual({})
    expect(request.query).toEqual({})
  })
})

describe('streamResponseBody', () => {
  it('writes a non-empty string body then ends', async () => {
    const sink = recordingSink()
    await streamResponseBody('hello', sink)
    expect(sink.writes).toEqual(['hello'])
    expect(sink.ended).toBe(true)
  })

  it('skips writing an empty string body but still ends', async () => {
    const sink = recordingSink()
    await streamResponseBody('', sink)
    expect(sink.writes).toEqual([])
    expect(sink.ended).toBe(true)
  })

  it('skips writing an empty Uint8Array chunk but still ends', async () => {
    const sink = recordingSink()
    await streamResponseBody(new Uint8Array(0), sink)
    expect(sink.writes).toEqual([])
    expect(sink.ended).toBe(true)
  })

  it('writes each chunk of an async-iterable string body', async () => {
    const sink = recordingSink()
    async function* chunks() {
      yield 'a'
      yield 'b'
    }
    await streamResponseBody(chunks(), sink)
    expect(sink.writes).toEqual(['a', 'b'])
    expect(sink.ended).toBe(true)
  })

  it('writes each chunk of an async-iterable Uint8Array body', async () => {
    const sink = recordingSink()
    async function* chunks() {
      yield new Uint8Array([1, 2])
      yield new Uint8Array([3])
    }
    await streamResponseBody(chunks(), sink)
    expect(sink.writes).toHaveLength(2)
    expect(sink.ended).toBe(true)
  })
})

describe('nodeStreamSink', () => {
  it('resolves write() and end() on success', async () => {
    const stream = fakeWritable()
    const sink = nodeStreamSink(stream)
    await sink.write('chunk')
    await sink.end()
    expect(stream.written).toEqual(['chunk'])
    expect(stream.isEnded()).toBe(true)
  })

  it('rejects write() when the underlying stream errors', async () => {
    const sink = nodeStreamSink(fakeWritable(true))
    await expect(sink.write('chunk')).rejects.toThrow('write failed')
  })

  it('delegates destroy() to the underlying stream', () => {
    const stream = fakeWritable()
    const sink = nodeStreamSink(stream)
    const error = new Error('boom')
    sink.destroy(error)
    expect(stream.destroyedWith()).toBe(error)
  })
})

describe('realStore', () => {
  it('memoizes the store across calls', () => {
    expect(realStore()).toBe(realStore())
  })
})

describe('adminEnv', () => {
  const KEY = 'AGENT_BLACKBOARD_ADMIN_CREDENTIALS'
  const original = process.env[KEY]

  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('returns {} when AGENT_BLACKBOARD_ADMIN_CREDENTIALS is unset', () => {
    delete process.env[KEY]
    expect(adminEnv()).toEqual({})
  })

  it('returns { AGENT_BLACKBOARD_ADMIN_CREDENTIALS } when set', () => {
    process.env[KEY] = 'token123'
    expect(adminEnv()).toEqual({ AGENT_BLACKBOARD_ADMIN_CREDENTIALS: 'token123' })
  })
})

describe('currentTime', () => {
  it('returns the current time as a Date', () => {
    expect(currentTime()).toBeInstanceOf(Date)
  })
})

describe('handle', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  function deps(overrides: Partial<HandleDeps> = {}): HandleDeps {
    return {
      handleRequest: async () =>
        ({ status: 200, headers: {}, body: chunkOf('ok') }) satisfies HandlerResponse,
      store: fakeStore,
      now: () => new Date(0),
      env: {} as AdminEnv,
      requestId: 'req-1',
      ...overrides,
    }
  }

  it('responds 400 without calling handleRequest when the event fails to parse', async () => {
    const calls: Array<{ status: number; headers: Record<string, string> }> = []
    const sink = recordingSink()
    const handleRequest = vi.fn()
    await handle(
      {} as unknown as LambdaFunctionUrlEvent,
      (status, headers) => {
        calls.push({ status, headers })
        return sink
      },
      deps({ handleRequest }),
    )

    expect(calls).toEqual([{ status: 400, headers: { 'content-type': 'application/json' } }])
    expect(JSON.parse(sink.writes[0] as string)).toEqual({ error: 'bad_request' })
    expect(handleRequest).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('responds 500 and logs a non-Error throw when handleRequest rejects', async () => {
    const sink = recordingSink()
    await handle(
      baseEvent(),
      () => sink,
      deps({
        handleRequest: async () => {
          throw 'boom' // eslint-disable-line no-throw-literal -- exercises the non-Error branch of errorMessage()
        },
      }),
    )
    expect(sink.ended).toBe(true)
    expect(JSON.parse(sink.writes[0] as string)).toEqual({ error: 'internal_error' })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"error":"boom"'))
  })

  it('threads store/now/env through to handleRequest', async () => {
    let seen: { store: BlackboardStore; now: () => Date; env: AdminEnv } | undefined
    const now = () => new Date(0)
    const env: AdminEnv = { AGENT_BLACKBOARD_ADMIN_CREDENTIALS: 'x' }
    await handle(
      baseEvent(),
      () => recordingSink(),
      deps({
        store: fakeStore,
        now,
        env,
        handleRequest: async (_request: HandlerRequest, requestDeps) => {
          seen = requestDeps
          return { status: 200, headers: {}, body: chunkOf('ok') }
        },
      }),
    )
    expect(seen).toEqual({ store: fakeStore, now, env })
  })

  it('streams a successful response through the sink returned by startStream', async () => {
    const sink = recordingSink()
    const started: Array<{ status: number; headers: Record<string, string> }> = []
    await handle(
      baseEvent(),
      (status, headers) => {
        started.push({ status, headers })
        return sink
      },
      deps({
        handleRequest: async () => ({
          status: 201,
          headers: { 'x-a': '1' },
          body: chunkOf('created'),
        }),
      }),
    )
    expect(started).toEqual([{ status: 201, headers: { 'x-a': '1' } }])
    expect(sink.writes).toEqual(['created'])
    expect(sink.ended).toBe(true)
  })

  it('logs and destroys — never cleanly ends — the sink when streaming the body throws mid-flight', async () => {
    // A clean end() here would look to the client exactly like a complete,
    // successful response, silently truncating the rest of the stream. The
    // sink must be destroyed instead, so the client sees a genuine
    // transport-level error (see docs/architecture.md#streaming-reads).
    const sink = recordingSink()
    async function* explode(): AsyncIterable<string> {
      yield 'partial'
      throw new Error('stream broke')
    }
    await handle(
      baseEvent(),
      () => sink,
      deps({ handleRequest: async () => ({ status: 200, headers: {}, body: explode() }) }),
    )
    expect(sink.writes).toEqual(['partial'])
    expect(sink.ended).toBe(false)
    expect(sink.destroyedWith?.message).toBe('stream broke')
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('stream broke'))
  })

  it('wraps a non-Error thrown value in a real Error before destroying the sink', async () => {
    const sink = recordingSink()
    // Not a generator function (which would need a `yield` to satisfy
    // require-yield) — matches throwingBody's shape above, just rejecting
    // with a non-Error value instead of an Error.
    const explode: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        // eslint-disable-next-line no-throw-literal -- exercises the non-Error branch of the destroy() wrap
        next: (): Promise<IteratorResult<string>> => Promise.reject('stream broke (string)'),
      }),
    }
    await handle(
      baseEvent(),
      () => sink,
      deps({ handleRequest: async () => ({ status: 200, headers: {}, body: explode }) }),
    )
    expect(sink.destroyedWith).toBeInstanceOf(Error)
    expect(sink.destroyedWith?.message).toBe('stream broke (string)')
  })

  it('swallows a failure from destroy() itself after a mid-flight streaming error', async () => {
    const sink = recordingSink()
    sink.destroy = () => {
      throw new Error('destroy failed')
    }
    await expect(
      handle(
        baseEvent(),
        () => sink,
        deps({
          handleRequest: async () => ({
            status: 200,
            headers: {},
            body: throwingBody('stream broke'),
          }),
        }),
      ),
    ).resolves.toBeUndefined()
  })
})

describe('handler (real Lambda wiring, end-to-end via the awslambda polyfill)', () => {
  it('routes a real request through the real handleRequest/store and streams a 404 for an unmatched path', async () => {
    const responseStream = fakeWritable()
    const event = baseEvent({
      requestContext: { http: { method: 'GET', path: '/nope' } },
      rawPath: '/nope',
    })
    const context: LambdaContext = { awsRequestId: 'req-smoke' }
    await (
      handler as (e: LambdaFunctionUrlEvent, s: WritableSink, c: LambdaContext) => Promise<void>
    )(event, responseStream, context)
    expect(responseStream.isEnded()).toBe(true)
    expect(JSON.parse(responseStream.written[0] as string)).toEqual({ error: 'not found' })
  })
})
