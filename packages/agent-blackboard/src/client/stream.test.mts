import { describe, expect, it, vi } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import {
  getEntriesRaw,
  parseJsonArrayBuffered,
  parseNdjsonStream,
  streamEntries,
} from './stream.mjs'
import type { SessionEntry } from './types.mjs'

const A: SessionEntry = { sessionId: 's', createdAt: 'a', data: { a: 1 } }
const B: SessionEntry = { sessionId: 's', createdAt: 'b', data: { b: 2 } }

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of items) result.push(item)
  return result
}

describe('entry response parsing', () => {
  it('handles absent, blank, chunked, and trailing NDJSON bodies', async () => {
    expect(await collect(parseNdjsonStream(new Response(null)))).toEqual([])
    expect(
      await collect(
        parseNdjsonStream(new Response(`${JSON.stringify(A)}\n\n${JSON.stringify(B)}`)),
      ),
    ).toEqual([A, B])
    const encoded = new TextEncoder().encode(`${JSON.stringify(A)}\n`)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 3))
        controller.enqueue(encoded.slice(3))
        controller.close()
      },
    })
    expect(await collect(parseNdjsonStream(new Response(body)))).toEqual([A])
  })

  it('handles empty and populated JSON arrays', async () => {
    expect(await collect(parseJsonArrayBuffered(new Response('')))).toEqual([])
    expect(await collect(parseJsonArrayBuffered(new Response(JSON.stringify([A, B]))))).toEqual([
      A,
      B,
    ])
  })
})

describe('entry reads', () => {
  it('requests one encoded session with the correct format', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      await getEntriesRaw(
        { baseUrl: fixture.baseUrl, token: 't' },
        { sessionId: 's/1', format: 'json' },
      )
      expect(fixture.requests[0]).toMatchObject({ url: '/sessions/s%2F1/entries?format=json' })
      expect(fixture.requests[0]!.headers.accept).toBe('application/json')
      await getEntriesRaw({ baseUrl: fixture.baseUrl, token: 't' }, { sessionId: 's' })
      expect(fixture.requests[1]!.headers.accept).toBe('application/json')
    } finally {
      await fixture.close()
    }
  })

  it('defaults structured reads to incremental jsonl and supports json arrays', async () => {
    const ndjson = await startHttpFixture((_req, res) => sendNdjson(res, [A, B]))
    try {
      expect(
        await collect(streamEntries({ baseUrl: ndjson.baseUrl, token: 't' }, { sessionId: 's' })),
      ).toEqual([A, B])
      expect(ndjson.requests[0]!.url).toContain('format=jsonl')
    } finally {
      await ndjson.close()
    }
    const json = await startHttpFixture((_req, res) => sendJson(res, 200, [A]))
    try {
      expect(
        await collect(
          streamEntries({ baseUrl: json.baseUrl, token: 't' }, { sessionId: 's', format: 'json' }),
        ),
      ).toEqual([A])
    } finally {
      await json.close()
    }
  })

  it('does not restart a response stream after it has started', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(A)}\n`))
        setTimeout(() => controller.error(new Error('stream interrupted')), 0)
      },
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const iterator = streamEntries(
        {
          baseUrl: 'https://example.test',
          token: 't',
          readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
        },
        { sessionId: 's' },
      )[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toEqual({ done: false, value: A })
      await expect(iterator.next()).rejects.toThrow('stream interrupted')
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
