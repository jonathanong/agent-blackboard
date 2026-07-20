import type { BodyChunk, RequestBody } from './types.mjs'

function isRawBody(body: RequestBody): body is string | Uint8Array | AsyncIterable<BodyChunk> {
  if (typeof body === 'string' || body instanceof Uint8Array) return true
  return body !== null && typeof body === 'object' && Symbol.asyncIterator in body
}

/** Leaves headroom under DynamoDB's 400KB item limit for PK/SK/entityType/etc. */
const MAX_BODY_BYTES = 380 * 1024

type BufferResult = { tooLarge: true } | { tooLarge: false; text: string }

/**
 * Buffers a raw string/Uint8Array/async-iterable body into UTF-8 text,
 * enforcing `MAX_BODY_BYTES` as bytes are counted rather than after the body
 * is fully buffered — an oversized async-iterable body stops being read as
 * soon as the running total crosses the limit, instead of draining fully
 * into memory first.
 */
async function bufferBody(
  body: string | Uint8Array | AsyncIterable<BodyChunk>,
): Promise<BufferResult> {
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return { tooLarge: true }
    return { tooLarge: false, text: body }
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength > MAX_BODY_BYTES) return { tooLarge: true }
    return { tooLarge: false, text: Buffer.from(body).toString('utf8') }
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    total += buf.byteLength
    if (total > MAX_BODY_BYTES) return { tooLarge: true }
    chunks.push(buf)
  }
  return { tooLarge: false, text: Buffer.concat(chunks).toString('utf8') }
}

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; tooLarge: boolean }

/**
 * Resolves a `HandlerRequest` body to a parsed JSON value. Handles all the
 * documented body shapes (see `core/types.mts`): an already-parsed value is
 * returned as-is; raw text/bytes/streams are buffered (subject to
 * `MAX_BODY_BYTES`) and `JSON.parse`'d (an empty/whitespace-only body
 * resolves to `undefined`, not an error).
 * Returns `{ ok: false, tooLarge: true }` if the raw body exceeds
 * `MAX_BODY_BYTES`, or `{ ok: false, tooLarge: false }` on invalid JSON text,
 * rather than throwing.
 */
export async function readJsonBody(body: RequestBody): Promise<JsonBodyResult> {
  if (body === undefined) return { ok: true, value: undefined }
  if (!isRawBody(body)) return { ok: true, value: body }
  const buffered = await bufferBody(body)
  if (buffered.tooLarge) return { ok: false, tooLarge: true }
  if (buffered.text.trim().length === 0) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(buffered.text) }
  } catch {
    return { ok: false, tooLarge: false }
  }
}
