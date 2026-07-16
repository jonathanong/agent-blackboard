import { describe, expect, it } from 'vitest'
import { sendJson, startHttpFixture } from '../__tests__/http-fixture.mjs'
import { AtelError } from './errors.mjs'
import { acceptHeaderFor, buildTelemetriesQuery, rawRequest, requestJson } from './http.mjs'

describe('buildTelemetriesQuery', () => {
  it('includes only defined fields, stringifying booleans', () => {
    expect(buildTelemetriesQuery({})).toEqual({})
    expect(
      buildTelemetriesQuery({
        sessionId: 's1',
        agent: 'claude-code',
        archived: false,
        format: 'jsonl',
      }),
    ).toEqual({ sessionId: 's1', agent: 'claude-code', archived: 'false', format: 'jsonl' })
    expect(buildTelemetriesQuery({ archived: true })).toEqual({ archived: 'true' })
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
  it('sends the bearer token, method, query, and body; returns the raw response', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      sendJson(res, 200, { ok: true })
    })
    try {
      const response = await rawRequest(
        { baseUrl: fixture.baseUrl, token: 'atl_sk_abc_def' },
        '/telemetry',
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
      expect(request.url).toBe('/telemetry?x=1')
      expect(request.headers.authorization).toBe('Bearer atl_sk_abc_def')
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
      await rawRequest({ baseUrl, token: 't' }, '/telemetry', { method: 'GET' })
      expect(fixture.requests[0]!.url).toBe('/telemetry')
    } finally {
      await fixture.close()
    }
  })

  it('throws AtelError with the parsed JSON body on a non-2xx JSON response', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      sendJson(res, 401, { message: 'bad token' })
    })
    try {
      await expect(
        rawRequest({ baseUrl: fixture.baseUrl, token: 't' }, '/telemetry', { method: 'GET' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AtelError)
        const atelError = err as AtelError
        expect(atelError.status).toBe(401)
        expect(atelError.body).toEqual({ message: 'bad token' })
        return true
      })
    } finally {
      await fixture.close()
    }
  })

  it('throws AtelError with raw text when the error body is not JSON', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
    })
    try {
      const error = await rawRequest({ baseUrl: fixture.baseUrl, token: 't' }, '/telemetry', {
        method: 'GET',
      }).catch((err: unknown) => err as AtelError)
      expect(error).toBeInstanceOf(AtelError)
      expect(error.status).toBe(500)
      expect(error.body).toBe('boom')
    } finally {
      await fixture.close()
    }
  })

  it('throws AtelError with an undefined body when the error response has no body', async () => {
    const fixture = await startHttpFixture((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end()
    })
    try {
      const error = await rawRequest({ baseUrl: fixture.baseUrl, token: 't' }, '/telemetry', {
        method: 'GET',
      }).catch((err: unknown) => err as AtelError)
      expect(error.status).toBe(404)
      expect(error.body).toBeUndefined()
    } finally {
      await fixture.close()
    }
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
        '/telemetry',
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
