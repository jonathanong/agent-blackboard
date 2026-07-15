// Response-streaming primitives shared by handler.mts's Lambda wiring and
// its unit tests — split out purely to keep handler.mts under the repo's
// 200-line cap; these have no knowledge of requests, routing, or logging.
import type { BodyChunk } from './core/types.mjs'

/**
 * The minimal shape this file needs from the underlying Lambda response
 * stream — deliberately narrower than node:stream's `Writable` class (which
 * has ~20 internal properties like `writableHighWaterMark`) so fakes/tests
 * only need to implement write/end/destroy, not the whole class shape. The
 * real Lambda streaming runtime's response stream satisfies this structurally.
 */
export interface WritableSink {
  write(chunk: BodyChunk, cb: (error?: Error | null) => void): unknown
  end(cb: () => void): unknown
  destroy(error?: Error): unknown
}

export interface ResponseStreamSink {
  write(chunk: BodyChunk): Promise<void>
  end(): Promise<void>
  /**
   * Aborts the underlying connection instead of ending it cleanly. Used when
   * `response.body` throws partway through iteration — by that point
   * status/headers are already sent, so the only way to avoid a truncated
   * stream silently looking like a complete, successful response is to make
   * the client see a genuine transport-level error instead of an EOF.
   */
  destroy(error: Error): void
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function nodeStreamSink(stream: WritableSink): ResponseStreamSink {
  return {
    write: (chunk) =>
      new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()))
      }),
    end: () => new Promise((resolve) => stream.end(resolve)),
    destroy: (error) => stream.destroy(error),
  }
}
