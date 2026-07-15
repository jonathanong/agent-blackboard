// Lambda Function URL (InvokeMode: RESPONSE_STREAM, see infra/template.yaml)
// entrypoint. A thin adapter: parse the Function URL event into the shared
// `handleRequest` request shape, call it, and pipe the response back as it
// streams. All the routing/business logic lives in ./core/handle-request.mts
// — this file only translates between the Lambda event/stream shapes and
// that framework-agnostic contract.
import { handleRequest } from './core/handle-request.mjs'
import type { HandleRequestDeps } from './core/handle-request.mjs'
import type { BodyChunk, HandlerRequest, HandlerResponse } from './core/types.mjs'
import { createDynamoStore } from './store/dynamo.mjs'
import type { AdminEnv } from './auth/admin.mjs'

// Injected by the Lambda Node runtime only under InvokeMode: RESPONSE_STREAM
// — doesn't exist outside it, hence the test-time polyfill in
// handler.test.mts and the narrow v8-ignore below around the code that
// touches it.
declare global {
  const awslambda: {
    streamifyResponse: (
      fn: (
        event: LambdaFunctionUrlEvent,
        stream: NodeJS.WritableStream,
        ctx: LambdaContext,
      ) => Promise<void>,
    ) => unknown
    HttpResponseStream: {
      from: (
        stream: NodeJS.WritableStream,
        metadata: { statusCode: number; headers?: Record<string, string> },
      ) => NodeJS.WritableStream
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

// ---- Pure response streaming ----

export interface ResponseStreamSink {
  write(chunk: BodyChunk): Promise<void>
  end(): Promise<void>
}

export async function streamResponseBody(
  body: BodyChunk | AsyncIterable<BodyChunk>,
  sink: ResponseStreamSink,
): Promise<void> {
  if (typeof body === 'string' || body instanceof Uint8Array) {
    if (body.length > 0) await sink.write(body)
  } else {
    for await (const chunk of body) await sink.write(chunk)
  }
  await sink.end()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    // change it now, only log and make sure the stream closes.
    logError('error while streaming response body', error, deps.requestId)
    await sink.end().catch(() => {})
  }
}

// ---- Real Lambda wiring below. Kept intentionally thin and delegated to
// handle(), which carries all the logic tested above. ----

export function nodeStreamSink(stream: NodeJS.WritableStream): ResponseStreamSink {
  return {
    write: (chunk) =>
      new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()))
      }),
    end: () => new Promise((resolve) => stream.end(resolve)),
  }
}

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
  return process.env.ADMIN_CREDENTIALS ? { ADMIN_CREDENTIALS: process.env.ADMIN_CREDENTIALS } : {}
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
