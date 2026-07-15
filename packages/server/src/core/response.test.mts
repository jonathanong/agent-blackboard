import { describe, expect, it } from 'vitest'
import {
  errorResponse,
  jsonResponse,
  notFoundResponse,
  streamResponse,
  unauthorizedResponse,
} from './response.mjs'

async function collect(iter: AsyncIterable<string | Uint8Array>): Promise<string> {
  let out = ''
  for await (const chunk of iter)
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  return out
}

describe('jsonResponse', () => {
  it('serializes the body and sets content-type', async () => {
    const response = jsonResponse(201, { ok: true })
    expect(response.status).toBe(201)
    expect(response.headers['content-type']).toBe('application/json')
    expect(await collect(response.body)).toBe('{"ok":true}')
  })

  it('merges extra headers', () => {
    const response = jsonResponse(200, {}, { 'x-test': '1' })
    expect(response.headers['x-test']).toBe('1')
  })
})

describe('errorResponse / notFoundResponse / unauthorizedResponse', () => {
  it('errorResponse wraps a message', async () => {
    const response = errorResponse(400, 'bad')
    expect(response.status).toBe(400)
    expect(await collect(response.body)).toBe('{"error":"bad"}')
  })

  it('notFoundResponse is a 404', async () => {
    expect(notFoundResponse().status).toBe(404)
  })

  it('unauthorizedResponse is a 401', async () => {
    expect(unauthorizedResponse().status).toBe(401)
  })
})

describe('streamResponse', () => {
  it('passes the iterable through with the given content-type', async () => {
    async function* gen(): AsyncGenerator<string> {
      yield 'a'
      yield 'b'
    }
    const response = streamResponse(200, 'text/plain', gen())
    expect(response.headers['content-type']).toBe('text/plain')
    expect(await collect(response.body)).toBe('ab')
  })
})
