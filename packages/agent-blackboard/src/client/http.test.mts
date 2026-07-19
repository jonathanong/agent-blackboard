import { describe, expect, it } from 'vitest'
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
