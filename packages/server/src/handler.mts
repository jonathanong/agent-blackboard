// Lambda Function URL (InvokeMode: RESPONSE_STREAM, see infra/template.yaml)
// entrypoint. A thin adapter: parse the Function URL event into the shared
// `handleRequest` request shape, call it, and pipe the response back as it
// streams. All the routing/business logic lives in ./core/handle-request.mts
// — this file only translates between the Lambda event/stream shapes and
// that framework-agnostic contract. Streaming primitives live in
// ./handler-stream.mts (split out to stay under the 200-line file cap).
import { handleRequest } from './core/handle-request.mjs'
import type { HandleRequestDeps } from './core/handle-request.mjs'
import type { HandlerRequest, HandlerResponse } from './core/types.mjs'
import { createDynamoStore } from './store/dynamo.mjs'
import type { AdminEnv } from './auth/admin.mjs'
import { errorMessage, nodeStreamSink, streamResponseBody } from './handler-stream.mjs'
import type { ResponseStreamSink, WritableSink } from './handler-stream.mjs'

export type { ResponseStreamSink, WritableSink } from './handler-stream.mjs'
export { errorMessage, nodeStreamSink, streamResponseBody } from './handler-stream.mjs'

// Injected by the Lambda Node runtime only under InvokeMode: RESPONSE_STREAM
// — doesn't exist outside it, hence the test-time polyfill in
// handler.test.mts and the narrow v8-ignore below around the code that
// touches it.
declare global {
  const awslambda: {
    streamifyResponse: (
      fn: (
        event: LambdaFunctionUrlEvent,
        stream: WritableSink,
        ctx: LambdaContext,
      ) => Promise<void>,
    ) => unknown
    HttpResponseStream: {
      from: (
        stream: WritableSink,
        metadata: { statusCode: number; headers?: Record<string, string> },
      ) => WritableSink
    }
  }
}

export interface LambdaFunctionUrlEvent {
  requestContext: { http: { method: string; path: string } }
  rawPath?: string
  queryStringParameters?: Record<string, string> | null
  headers?: Record<string, string> | null
  body?: string | null
  isBase64Encoded?: boolean
}

export interface LambdaContext {
  awsRequestId: string
}

export type HandleRequestFn = typeof handleRequest

// ---- Pure event parsing ----

export function parseFunctionUrlEvent(event: LambdaFunctionUrlEvent): HandlerRequest {
  const method = event.requestContext.http.method
  const path = event.rawPath ?? event.requestContext.http.path
  const query = event.queryStringParameters ?? {}
  const headers = normalizeHeaders(event.headers ?? {})
  const body = decodeBody(event.body, event.isBase64Encoded ?? false)
  return { method, path, query, headers, body }
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value
  return normalized
}

function decodeBody(raw: string | null | undefined, isBase64Encoded: boolean): unknown {
  if (raw === null || raw === undefined || raw === '') return undefined
  return isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw
}

function logError(msg: string, error: unknown, requestId?: string): void {
  console.error(JSON.stringify({ level: 'error', msg, error: errorMessage(error), requestId }))
}

// ---- Core adapter logic (fully unit-testable via injected deps) ----

export type StartResponseStream = (
  statusCode: number,
  headers: Record<string, string>,
) => ResponseStreamSink

export interface HandleDeps extends HandleRequestDeps {
  handleRequest: HandleRequestFn
  requestId?: string
}

export async function handle(
  event: LambdaFunctionUrlEvent,
  startStream: StartResponseStream,
  deps: HandleDeps,
): Promise<void> {
  let request: HandlerRequest
  try {
    request = parseFunctionUrlEvent(event)
  } catch (error) {
    logError('failed to parse Function URL event', error, deps.requestId)
    await streamResponseBody(
      JSON.stringify({ error: 'bad_request' }),
      startStream(400, { 'content-type': 'application/json' }),
    )
    return
  }

  let response: HandlerResponse
  try {
    response = await deps.handleRequest(request, {
      store: deps.store,
      now: deps.now,
      env: deps.env,
    })
  } catch (error) {
    logError('handleRequest threw', error, deps.requestId)
    await streamResponseBody(
      JSON.stringify({ error: 'internal_error' }),
      startStream(500, { 'content-type': 'application/json' }),
    )
    return
  }

  const sink = startStream(response.status, response.headers)
  try {
    await streamResponseBody(response.body, sink)
  } catch (error) {
    // The response has already started (status/headers sent) — we can't
    // change them now. Destroy, don't end: a clean end() here would look
    // to the client exactly like a complete, successful response, silently
    // truncating whatever data hadn't streamed yet (see
    // docs/architecture.md's streaming-reads section).
    logError('error while streaming response body', error, deps.requestId)
    try {
      sink.destroy(error instanceof Error ? error : new Error(errorMessage(error)))
    } catch {
      // destroy() itself failing shouldn't crash the handler — the
      // connection is already broken one way or another at this point.
    }
  }
}

// ---- Real Lambda wiring below. Kept intentionally thin and delegated to
// handle(), which carries all the logic tested above. ----

// Constructed lazily (not at module scope) and memoized per execution
// environment, so a warm Lambda container reuses one DynamoDB client/store
// across invocations without paying that construction cost on every import
// of this module (e.g. by tests, which never invoke `handler` itself).
let store: ReturnType<typeof createDynamoStore> | undefined

export function realStore(): ReturnType<typeof createDynamoStore> {
  store ??= createDynamoStore()
  return store
}

export function adminEnv(): AdminEnv {
  return process.env.ATEL_ADMIN_CREDENTIALS
    ? { ATEL_ADMIN_CREDENTIALS: process.env.ATEL_ADMIN_CREDENTIALS }
    : {}
}

export function currentTime(): Date {
  return new Date()
}

export const handler = awslambda.streamifyResponse(async (event, responseStream, context) => {
  await handle(
    event,
    (statusCode, headers) =>
      nodeStreamSink(awslambda.HttpResponseStream.from(responseStream, { statusCode, headers })),
    {
      handleRequest,
      store: realStore(),
      now: currentTime,
      env: adminEnv(),
      requestId: context.awsRequestId,
    },
  )
})
