import { describe, expect, it } from 'vitest'
import { sendJson, sendNdjson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import {
  fetchJournalsRaw,
  parseJsonArrayBuffered,
  parseNdjsonStream,
  streamEntries,
} from './stream.mjs'
import type { JournalEntry } from './types.mjs'

const ENTRY_A: JournalEntry = {
  id: 'a',
  sessionId: 's',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: {},
}
const ENTRY_B: JournalEntry = {
  id: 'b',
  sessionId: 's',
  agent: 'claude-code',
  createdAt: 'now',
  archived: false,
  data: {},
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}

describe('parseNdjsonStream', () => {
  it('yields nothing when the response has no body', async () => {
    const response = new Response(null)
    expect(await collect(parseNdjsonStream(response))).toEqual([])
  })

  it('skips blank lines and yields an unterminated trailing line', async () => {
    const response = new Response(`${JSON.stringify(ENTRY_A)}\n\n${JSON.stringify(ENTRY_B)}`)
    expect(await collect(parseNdjsonStream(response))).toEqual([ENTRY_A, ENTRY_B])
  })

  it('reassembles a JSON line split across multiple chunks', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const line = JSON.stringify(ENTRY_A)
        controller.enqueue(encoder.encode(line.slice(0, 5)))
        controller.enqueue(encoder.encode(`${line.slice(5)}\n`))
        controller.close()
      },
    })
    expect(await collect(parseNdjsonStream(new Response(body)))).toEqual([ENTRY_A])
  })

  it('yields each entry as soon as its line arrives, not after the full body', async () => {
    const encoder = new TextEncoder()
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller
      },
    })
    const iterator = parseNdjsonStream(new Response(body))[Symbol.asyncIterator]()

    const firstPromise = iterator.next()
    controllerRef!.enqueue(encoder.encode(`${JSON.stringify(ENTRY_A)}\n`))
    expect(await firstPromise).toEqual({ done: false, value: ENTRY_A })

    const secondPromise = iterator.next()
    controllerRef!.enqueue(encoder.encode(`${JSON.stringify(ENTRY_B)}\n`))
    controllerRef!.close()
    expect(await secondPromise).toEqual({ done: false, value: ENTRY_B })

    expect((await iterator.next()).done).toBe(true)
  })
})

describe('parseJsonArrayBuffered', () => {
  it('yields nothing for an empty body', async () => {
    expect(await collect(parseJsonArrayBuffered(new Response('')))).toEqual([])
  })

  it('parses and yields each entry from a JSON array body', async () => {
    const response = new Response(JSON.stringify([ENTRY_A, ENTRY_B]))
    expect(await collect(parseJsonArrayBuffered(response))).toEqual([ENTRY_A, ENTRY_B])
  })
})

describe('fetchJournalsRaw', () => {
  it('defaults to the json Accept header and omits format from the query when unset', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, []))
    try {
      await fetchJournalsRaw({ baseUrl: fixture.baseUrl, token: 't' }, {})
      const request = fixture.requests[0]!
      expect(request.headers.accept).toBe('application/json')
      expect(request.url).toBe('/journals')
    } finally {
      await fixture.close()
    }
  })

  it('sends the explicit format and Accept header, plus sessionId/agent/archived params', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, []))
    try {
      await fetchJournalsRaw(
        { baseUrl: fixture.baseUrl, token: 't' },
        { sessionId: 's1', agent: 'claude-code', archived: false, format: 'jsonl' },
      )
      const request = fixture.requests[0]!
      expect(request.headers.accept).toBe('application/x-ndjson')
      const url = new URL(request.url, fixture.baseUrl)
      expect(url.searchParams.get('sessionId')).toBe('s1')
      expect(url.searchParams.get('agent')).toBe('claude-code')
      expect(url.searchParams.get('archived')).toBe('false')
      expect(url.searchParams.get('format')).toBe('jsonl')
    } finally {
      await fixture.close()
    }
  })
})

describe('streamEntries', () => {
  it('defaults to jsonl and streams parsed entries incrementally over the wire', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, [ENTRY_A, ENTRY_B]))
    try {
      const entries = await collect(streamEntries({ baseUrl: fixture.baseUrl, token: 't' }))
      expect(entries).toEqual([ENTRY_A, ENTRY_B])
      expect(new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('format')).toBe(
        'jsonl',
      )
    } finally {
      await fixture.close()
    }
  })

  it('buffers a JSON array when format: "json" is requested explicitly', async () => {
    const fixture = await startHttpFixture((_req, res) => sendJson(res, 200, [ENTRY_A, ENTRY_B]))
    try {
      const entries = await collect(
        streamEntries({ baseUrl: fixture.baseUrl, token: 't' }, { format: 'json' }),
      )
      expect(entries).toEqual([ENTRY_A, ENTRY_B])
      expect(new URL(fixture.requests[0]!.url, fixture.baseUrl).searchParams.get('format')).toBe(
        'json',
      )
    } finally {
      await fixture.close()
    }
  })

  it('forwards sessionId/agent/archived filters', async () => {
    const fixture = await startHttpFixture((_req, res) => sendNdjson(res, []))
    try {
      await collect(
        streamEntries(
          { baseUrl: fixture.baseUrl, token: 't' },
          { sessionId: 's1', agent: 'claude-code', archived: true },
        ),
      )
      const url = new URL(fixture.requests[0]!.url, fixture.baseUrl)
      expect(url.searchParams.get('sessionId')).toBe('s1')
      expect(url.searchParams.get('agent')).toBe('claude-code')
      expect(url.searchParams.get('archived')).toBe('true')
    } finally {
      await fixture.close()
    }
  })
})
