import type { BodyChunk, RequestBody } from './types.mjs'

function isRawBody(body: RequestBody): body is string | Uint8Array | AsyncIterable<BodyChunk> {
  if (typeof body === 'string' || body instanceof Uint8Array) return true
  return body !== null && typeof body === 'object' && Symbol.asyncIterator in body
}

/** Buffers a raw string/Uint8Array/async-iterable body into UTF-8 text. */
async function bufferBody(body: string | Uint8Array | AsyncIterable<BodyChunk>): Promise<string> {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  const chunks: Buffer[] = []
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false }

/**
 * Resolves a `HandlerRequest` body to a parsed JSON value. Handles all the
 * documented body shapes (see `core/types.mts`): an already-parsed value is
 * returned as-is; raw text/bytes/streams are buffered and `JSON.parse`'d
 * (an empty/whitespace-only body resolves to `undefined`, not an error).
 * Returns `{ ok: false }` on invalid JSON text rather than throwing.
 */
export async function readJsonBody(body: RequestBody): Promise<JsonBodyResult> {
  if (body === undefined) return { ok: true, value: undefined }
  if (!isRawBody(body)) return { ok: true, value: body }
  const text = await bufferBody(body)
  if (text.trim().length === 0) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}
