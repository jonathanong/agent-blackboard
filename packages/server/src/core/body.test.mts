import { describe, expect, it } from 'vitest'
import { readJsonBody } from './body.mjs'

async function* asyncChunks(
  chunks: Array<string | Uint8Array>,
): AsyncGenerator<string | Uint8Array> {
  for (const chunk of chunks) yield chunk
}

describe('readJsonBody', () => {
  it('resolves undefined body to undefined', async () => {
    expect(await readJsonBody(undefined)).toEqual({ ok: true, value: undefined })
  })

  it('parses a JSON string body', async () => {
    expect(await readJsonBody('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('resolves empty/whitespace string bodies to undefined', async () => {
    expect(await readJsonBody('   ')).toEqual({ ok: true, value: undefined })
  })

  it('parses a Uint8Array body', async () => {
    const bytes = new TextEncoder().encode('{"a":1}')
    expect(await readJsonBody(bytes)).toEqual({ ok: true, value: { a: 1 } })
  })

  it('buffers and parses an async-iterable body of mixed string/Uint8Array chunks', async () => {
    const chunks = asyncChunks(['{"a":', new TextEncoder().encode('1}')])
    expect(await readJsonBody(chunks)).toEqual({ ok: true, value: { a: 1 } })
  })

  it('passes through an already-parsed object body untouched', async () => {
    const value = { already: 'parsed' }
    expect(await readJsonBody(value)).toEqual({ ok: true, value })
  })

  it('passes through an already-parsed array body untouched', async () => {
    const value = [1, 2, 3]
    expect(await readJsonBody(value)).toEqual({ ok: true, value })
  })

  it('returns ok:false, tooLarge:false on invalid JSON text', async () => {
    expect(await readJsonBody('not json')).toEqual({ ok: false, tooLarge: false })
  })

  it('rejects a string body over the size cap', async () => {
    const huge = 'a'.repeat(380 * 1024 + 1)
    expect(await readJsonBody(huge)).toEqual({ ok: false, tooLarge: true })
  })

  it('rejects a Uint8Array body over the size cap', async () => {
    const huge = new Uint8Array(380 * 1024 + 1)
    expect(await readJsonBody(huge)).toEqual({ ok: false, tooLarge: true })
  })

  it('rejects an async-iterable body once accumulated chunks cross the size cap, without draining it', async () => {
    const chunkSize = 200 * 1024
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(chunkSize)
      yield new Uint8Array(chunkSize)
      throw new Error('should never be reached: iterable was drained past the size cap')
    }
    expect(await readJsonBody(chunks())).toEqual({ ok: false, tooLarge: true })
  })
})
