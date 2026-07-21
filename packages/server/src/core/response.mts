import type { HandlerResponse } from './types.mjs'

async function* singleChunk(text: string): AsyncGenerator<string> {
  yield text
}

export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): HandlerResponse {
  return {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: singleChunk(JSON.stringify(body)),
  }
}

export function errorResponse(status: number, message: string): HandlerResponse {
  return jsonResponse(status, { error: message })
}

export function notFoundResponse(): HandlerResponse {
  return errorResponse(404, 'not found')
}

export function unauthorizedResponse(): HandlerResponse {
  return errorResponse(401, 'unauthorized')
}

export function payloadTooLargeResponse(): HandlerResponse {
  return errorResponse(413, 'request body too large')
}

export function streamResponse(
  status: number,
  contentType: string,
  body: AsyncIterable<string>,
): HandlerResponse {
  return { status, headers: { 'content-type': contentType }, body }
}
