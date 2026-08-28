import { describe, expect, it, vi } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { AgentBlackboardError } from './errors.mjs'
import { acceptHeaderFor, buildEntriesQuery, rawRequest, requestJson } from './http.mjs'

describe('buildEntriesQuery', () => {
  it('includes only an explicit format', () => {
    expect(buildEntriesQuery()).toEqual({})
    expect(buildEntriesQuery('jsonl')).toEqual({ format: 'jsonl' })
  })
})

describe('acceptHeaderFor', () => {
  it('maps each wire format to its Accept header', () => {
    expect(acceptHeaderFor('json')).toBe('application/json')
    expect(acceptHeaderFor('jsonl')).toBe('application/x-ndjson')
    expect(acceptHeaderFor('markdown')).toBe('text/markdown')
  })
})

describe('rawRequest', () => {
  it('rejects remote HTTP URLs before constructing an authorization header', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest({ baseUrl: 'http://example.test', token: 'secret' }, '/sessions/s1', {
          method: 'GET',
        }),
      ).rejects.toThrow('baseUrl must use HTTPS')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('makes one request by default when fetch rejects', async () => {
    const failure = new TypeError('fetch failed')
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure)
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest({ baseUrl: 'https://example.test', token: 't' }, '/sessions/s1', {
          method: 'GET',
        }),
      ).rejects.toBe(failure)
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses default retry settings when readRetry is empty', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const response = rawRequest(
        { baseUrl: 'https://example.test', token: 't', readRetry: {} },
        '/sessions/s1',
        { method: 'GET' },
      )
      await vi.advanceTimersByTimeAsync(99)
      expect(fetchMock).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await expect(response).resolves.toBeInstanceOf(Response)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('sends the bearer token, method, query, and body; returns the raw response', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      sendJson(res, 200, { ok: true })
    })
    try {
      const response = await rawRequest(
        { baseUrl: fixture.baseUrl, token: 'abb_sk_abc_def' },
        '/sessions/s1/entries',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"a":1}',
          query: { x: '1' },
        },
      )
      expect(response.ok).toBe(true)
      expect(fixture.requests).toHaveLength(1)
      const request = fixture.requests[0]!
      expect(request.method).toBe('POST')
      expect(request.url).toBe('/sessions/s1/entries?x=1')
      expect(request.headers.authorization).toBe('Bearer abb_sk_abc_def')
      expect(request.body).toBe('{"a":1}')
    } finally {
      await fixture.close()
    }
  })

  it('builds the request URL against a base URL without a trailing slash', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      sendJson(res, 200, { ok: true })
    })
    try {
      const baseUrl = fixture.baseUrl.replace(/\/$/, '')
      await rawRequest({ baseUrl, token: 't' }, '/sessions/s1/entries', { method: 'GET' })
      expect(fixture.requests[0]!.url).toBe('/sessions/s1/entries')
    } finally {
      await fixture.close()
    }
  })

  it('throws AgentBlackboardError with the parsed JSON body on a non-2xx JSON response', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      sendJson(res, 401, { message: 'bad token' })
    })
    try {
      await expect(
        rawRequest({ baseUrl: fixture.baseUrl, token: 't' }, '/sessions/s1/entries', {
          method: 'GET',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AgentBlackboardError)
        const agentBlackboardError = err as AgentBlackboardError
        expect(agentBlackboardError.status).toBe(401)
        expect(agentBlackboardError.body).toEqual({ message: 'bad token' })
        return true
      })
    } finally {
      await fixture.close()
    }
  })

  it('throws AgentBlackboardError with raw text when the error body is not JSON', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
    })
    try {
      const error = await rawRequest(
        { baseUrl: fixture.baseUrl, token: 't' },
        '/sessions/s1/entries',
        {
          method: 'GET',
        },
      ).catch((err: unknown) => err as AgentBlackboardError)
      expect(error).toBeInstanceOf(AgentBlackboardError)
      expect(error.status).toBe(500)
      expect(error.body).toBe('boom')
    } finally {
      await fixture.close()
    }
  })

  it('throws AgentBlackboardError with an undefined body when the error response has no body', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end()
    })
    try {
      const error = await rawRequest(
        { baseUrl: fixture.baseUrl, token: 't' },
        '/sessions/s1/entries',
        {
          method: 'GET',
        },
      ).catch((err: unknown) => err as AgentBlackboardError)
      expect(error.status).toBe(404)
      expect(error.body).toBeUndefined()
    } finally {
      await fixture.close()
    }
  })

  it('retries configured transient responses, discarding the intermediate body', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('temporary'))
      },
      cancel,
    })
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(body, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        requestJson<{ ok: boolean }>(
          {
            baseUrl: 'https://example.test',
            token: 't',
            readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
          },
          '/sessions/s1',
          { method: 'GET' },
        ),
      ).resolves.toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([408, 429, 500, 502, 504])('retries configured HTTP %i responses', async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest(
          {
            baseUrl: 'https://example.test',
            token: 't',
            readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
          },
          '/sessions/s1',
          { method: 'GET' },
        ),
      ).resolves.toBeInstanceOf(Response)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses capped exponential retry delays', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('first failed'))
      .mockRejectedValueOnce(new TypeError('second failed'))
      .mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const response = rawRequest(
        {
          baseUrl: 'https://example.test',
          token: 't',
          readRetry: { maxRetries: 2, initialDelayMs: 20, maxDelayMs: 25 },
        },
        '/sessions/s1',
        { method: 'GET' },
      )
      await vi.advanceTimersByTimeAsync(19)
      expect(fetchMock).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(24)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await expect(response).resolves.toBeInstanceOf(Response)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('rethrows an exhausted fetch rejection unchanged', async () => {
    const failure = new TypeError('fetch failed')
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure)
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest(
          {
            baseUrl: 'https://example.test',
            token: 't',
            readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
          },
          '/sessions/s1',
          { method: 'GET' },
        ),
      ).rejects.toBe(failure)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves AgentBlackboardError after exhausting transient HTTP responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('unavailable', { status: 503 })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest(
          {
            baseUrl: 'https://example.test',
            token: 't',
            readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
          },
          '/sessions/s1',
          { method: 'GET' },
        ),
      ).rejects.toMatchObject({ status: 503, body: 'unavailable' })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([401, 404])('does not retry configured HTTP %i responses', async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest(
          {
            baseUrl: 'https://example.test',
            token: 't',
            readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
          },
          '/sessions/s1',
          { method: 'GET' },
        ),
      ).rejects.toMatchObject({ status })
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not retry writes even when read retries are configured', async () => {
    const failure = new TypeError('fetch failed')
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure)
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        rawRequest(
          {
            baseUrl: 'https://example.test',
            token: 't',
            readRetry: { initialDelayMs: 0, maxDelayMs: 0 },
          },
          '/sessions/s1/entries',
          { method: 'POST', body: '{}' },
        ),
      ).rejects.toBe(failure)
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a non-object read retry configuration', async () => {
    await expect(
      rawRequest(
        { baseUrl: 'https://example.test', token: 't', readRetry: null as never },
        '/sessions/s1',
        { method: 'GET' },
      ),
    ).rejects.toThrow('readRetry must be an object')
  })

  it.each([
    { readRetry: { maxRetries: -1 }, message: 'maxRetries' },
    { readRetry: { maxRetries: 11 }, message: 'maxRetries' },
    { readRetry: { initialDelayMs: -1 }, message: 'initialDelayMs' },
    { readRetry: { maxDelayMs: 60_001 }, message: 'maxDelayMs' },
  ])('rejects invalid read retry options', async ({ readRetry, message }) => {
    await expect(
      rawRequest({ baseUrl: 'https://example.test', token: 't', readRetry }, '/sessions/s1', {
        method: 'GET',
      }),
    ).rejects.toThrow(message)
  })
})

describe('requestJson', () => {
  it('parses the response body as JSON', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      sendJson(res, 200, { id: 'abc' })
    })
    try {
      const result = await requestJson<{ id: string }>(
        { baseUrl: fixture.baseUrl, token: 't' },
        '/sessions/s1/entries',
        {
          method: 'GET',
        },
      )
      expect(result).toEqual({ id: 'abc' })
    } finally {
      await fixture.close()
    }
  })
})
