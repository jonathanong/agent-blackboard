import { describe, expect, it } from 'vitest'
import { MemoryTelemetryStore } from '../store/memory.mjs'
import { handleRequest } from './handle-request.mjs'
import type { HandleRequestDeps } from './handle-request.mjs'
import type { HandlerRequest } from './types.mjs'

function deps(overrides: Partial<HandleRequestDeps> = {}): HandleRequestDeps {
  return {
    store: new MemoryTelemetryStore(),
    now: () => new Date('2024-01-01T00:00:00.000Z'),
    env: {},
    ...overrides,
  }
}

function request(overrides: Partial<HandlerRequest>): HandlerRequest {
  return { method: 'GET', path: '/nope', query: {}, headers: {}, ...overrides }
}

describe('handleRequest', () => {
  it('404s an unknown path', async () => {
    const response = await handleRequest(request({ path: '/nope' }), deps())
    expect(response.status).toBe(404)
  })

  it('404s the root path', async () => {
    const response = await handleRequest(request({ path: '/' }), deps())
    expect(response.status).toBe(404)
  })

  it('normalizes a trailing slash before matching a route', async () => {
    const response = await handleRequest(request({ path: '/telemetry/' }), deps())
    // No auth header -> still routed to the telemetry handler (401), not 404.
    expect(response.status).toBe(401)
  })

  it('routes /telemetry to the telemetry handler', async () => {
    const response = await handleRequest(request({ path: '/telemetry' }), deps())
    expect(response.status).toBe(401)
  })

  it('routes /credentials to the credentials handler', async () => {
    const response = await handleRequest(request({ path: '/credentials' }), deps())
    expect(response.status).toBe(401)
  })
})
