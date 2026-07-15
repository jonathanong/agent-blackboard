import { describe, expect, it } from 'vitest'
import { readJsonBody, readRawBodyText } from './body.mjs'

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

  it('returns ok:false on invalid JSON text', async () => {
    expect(await readJsonBody('not json')).toEqual({ ok: false })
  })
})

describe('readRawBodyText', () => {
  it('returns empty string for undefined body', async () => {
    expect(await readRawBodyText(undefined)).toBe('')
  })

  it('returns the string as-is', async () => {
    expect(await readRawBodyText('hello')).toBe('hello')
  })

  it('returns undefined for an already-parsed value', async () => {
    expect(await readRawBodyText({ a: 1 })).toBeUndefined()
  })
})
