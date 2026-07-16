import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hashToken } from './auth/hash.mjs'
import { generateTelemetryToken } from './auth/tokens.mjs'
import type { CredentialRecord, TelemetryEntry } from './core/types.mjs'
import {
  adminEnvFromProcess,
  createServer,
  currentTime,
  parseIncomingRequest,
  respond,
  storeFromProcess,
} from './local-server.mjs'
import { MemoryTelemetryStore } from './store/memory.mjs'
import type { TelemetryStore } from './store/store.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

function fakeIncomingMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { method: 'GET', url: '/', headers: {}, ...overrides } as unknown as IncomingMessage
}

function fakeServerResponse(opts: { failWriteHead?: boolean; failWrite?: boolean } = {}) {
  const written: unknown[] = []
  let headersSent = false
  let ended = false
  let destroyedWith: Error | undefined
  const res = {
    get headersSent() {
      return headersSent
    },
    writeHead: (status: number, headers?: Record<string, string>) => {
      if (opts.failWriteHead) throw new Error('writeHead failed')
      headersSent = true
      written.push({ status, headers })
      return res
    },
    write: (chunk: unknown, cb: (error?: Error) => void) => {
      if (opts.failWrite) {
        cb(new Error('write failed'))
        return true
      }
      written.push(chunk)
      cb()
      return true
    },
    end: (body?: unknown) => {
      ended = true
      if (body !== undefined) written.push(body)
      return res
    },
    destroy: (error?: Error) => {
      destroyedWith = error
      return res
    },
  }
  return Object.assign(res, {
    written,
    isEnded: () => ended,
    destroyedWith: () => destroyedWith,
  })
}

function notImplementedStore(overrides: Partial<TelemetryStore> = {}): TelemetryStore {
  const notImplemented = (name: string) => () => {
    throw new Error(`${name} not implemented in this test double`)
  }
  return {
    appendEntry: notImplemented('appendEntry'),
    getEntries: notImplemented('getEntries'),
    patchEntries: notImplemented('patchEntries'),
    createCredential: notImplemented('createCredential'),
    listCredentials: notImplemented('listCredentials'),
    getCredentialById: notImplemented('getCredentialById'),
    deleteCredential: notImplemented('deleteCredential'),
    ...overrides,
  } as TelemetryStore
}

describe('parseIncomingRequest', () => {
  it('parses method, path, and query params (last value wins on repeats)', () => {
    const request = parseIncomingRequest(
      fakeIncomingMessage({ url: '/telemetry?a=1&b=2&a=3', method: 'get' }),
    )
    expect(request.method).toBe('GET')
    expect(request.path).toBe('/telemetry')
    expect(request.query).toEqual({ a: '3', b: '2' })
  })

  it('joins multi-value headers with ", " and drops undefined values', () => {
    const request = parseIncomingRequest(
      fakeIncomingMessage({
        headers: { 'x-multi': ['a', 'b'], 'x-single': 'x', 'x-missing': undefined },
      }),
    )
    expect(request.headers).toEqual({ 'x-multi': 'a, b', 'x-single': 'x' })
  })

  it('defaults method to GET when absent and passes the raw message through as body', () => {
    const req = fakeIncomingMessage({ method: undefined, url: '/telemetry' })
    const request = parseIncomingRequest(req)
    expect(request.method).toBe('GET')
    expect(request.body).toBe(req)
  })

  it('defaults the path to "/" when url is absent', () => {
    const request = parseIncomingRequest(fakeIncomingMessage({ url: undefined }))
    expect(request.path).toBe('/')
  })
})

describe('currentTime', () => {
  it('returns the current time as a Date', () => {
    expect(currentTime()).toBeInstanceOf(Date)
  })
})

describe('adminEnvFromProcess / storeFromProcess', () => {
  const ORIGINAL_ADMIN = process.env.ATEL_ADMIN_CREDENTIALS
  const ORIGINAL_STORE = process.env.ATEL_STORE

  afterEach(() => {
    if (ORIGINAL_ADMIN === undefined) delete process.env.ATEL_ADMIN_CREDENTIALS
    else process.env.ATEL_ADMIN_CREDENTIALS = ORIGINAL_ADMIN
    if (ORIGINAL_STORE === undefined) delete process.env.ATEL_STORE
    else process.env.ATEL_STORE = ORIGINAL_STORE
  })

  it('adminEnvFromProcess reflects ATEL_ADMIN_CREDENTIALS presence', () => {
    delete process.env.ATEL_ADMIN_CREDENTIALS
    expect(adminEnvFromProcess()).toEqual({})
    process.env.ATEL_ADMIN_CREDENTIALS = 'abc'
    expect(adminEnvFromProcess()).toEqual({ ATEL_ADMIN_CREDENTIALS: 'abc' })
  })

  it('storeFromProcess picks the in-memory store only when ATEL_STORE=memory', () => {
    process.env.ATEL_STORE = 'memory'
    expect(storeFromProcess()).toBeInstanceOf(MemoryTelemetryStore)
    process.env.ATEL_STORE = 'dynamo'
    expect(storeFromProcess()).not.toBeInstanceOf(MemoryTelemetryStore)
  })
})

describe('respond (unit, fake req/res)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  afterEach(() => {
    consoleError?.mockRestore()
  })

  it('responds 500 and logs when handleRequest throws before any response is sent', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const req = fakeIncomingMessage({
      method: 'GET',
      url: '/telemetry',
      headers: { authorization: 'Bearer nope' },
    })
    const res = fakeServerResponse()
    const store = notImplementedStore({
      getCredentialById: async () => {
        throw new Error('db unavailable')
      },
    })
    // A syntactically valid telemetry token so auth resolution reaches the store.
    const { token } = generateTelemetryToken()
    req.headers.authorization = `Bearer ${token}`

    await respond(req, res as unknown as ServerResponse, { store })

    expect(res.written[0]).toEqual({ status: 500, headers: { 'content-type': 'application/json' } })
    expect(JSON.parse(res.written[1] as string)).toEqual({ error: 'internal_error' })
    expect(res.isEnded()).toBe(true)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('db unavailable'))
  })

  it('responds 500 and logs a non-Error throw from handleRequest', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { token } = generateTelemetryToken()
    const req = fakeIncomingMessage({
      method: 'GET',
      url: '/telemetry',
      headers: { authorization: `Bearer ${token}` },
    })
    const res = fakeServerResponse()
    const store = notImplementedStore({
      getCredentialById: async () => {
        // eslint-disable-next-line no-throw-literal -- exercises the non-Error branch of errorMessage()
        throw 'db string error'
      },
    })

    await respond(req, res as unknown as ServerResponse, { store })

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('db string error'))
  })

  it('logs and destroys — never cleanly ends — the response when writeHead itself throws', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const req = fakeIncomingMessage({ method: 'GET', url: '/nope' })
    const res = fakeServerResponse({ failWriteHead: true })
    const store = notImplementedStore()

    await respond(req, res as unknown as ServerResponse, { store })

    expect(res.isEnded()).toBe(false)
    expect(res.destroyedWith()?.message).toBe('writeHead failed')
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('writeHead failed'))
  })

  it('writes entries as they stream and destroys — not cleanly ends — on a mid-stream failure', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { token, credId } = generateTelemetryToken()
    const record: CredentialRecord = {
      id: credId,
      name: 'test',
      tokenHash: hashToken(token),
      createdAt: new Date(0).toISOString(),
    }
    const store = notImplementedStore({
      getCredentialById: async (id) => (id === credId ? record : undefined),
      getEntries: async function* explode() {
        yield {
          id: 's1#e1',
          credId,
          sessionId: 's1',
          agent: 'test',
          createdAt: new Date(0).toISOString(),
          archived: false,
          data: {},
          ttl: 0,
        }
        throw new Error('scan broke')
      },
    })
    const req = fakeIncomingMessage({
      method: 'GET',
      url: '/telemetry',
      headers: { authorization: `Bearer ${token}` },
    })
    const res = fakeServerResponse()

    await respond(req, res as unknown as ServerResponse, { store })

    expect(res.written[0]).toEqual({ status: 200, headers: { 'content-type': 'application/json' } })
    expect(res.written).toContain('[')
    expect(res.isEnded()).toBe(false)
    expect(res.destroyedWith()?.message).toBe('scan broke')
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('scan broke'))
  })

  it('wraps a non-Error thrown value in a real Error before destroying on a mid-stream failure', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { token, credId } = generateTelemetryToken()
    const record: CredentialRecord = {
      id: credId,
      name: 'test',
      tokenHash: hashToken(token),
      createdAt: new Date(0).toISOString(),
    }
    const store = notImplementedStore({
      getCredentialById: async (id) => (id === credId ? record : undefined),
      // Not a generator function (which would need a `yield` to satisfy
      // require-yield) — a plain async-iterable object still satisfies
      // AsyncIterable<TelemetryEntry> structurally.
      getEntries: () => ({
        [Symbol.asyncIterator]: () => ({
          // eslint-disable-next-line no-throw-literal -- exercises the non-Error branch of the destroy() wrap
          next: (): Promise<IteratorResult<TelemetryEntry>> =>
            Promise.reject('scan broke (string)'),
        }),
      }),
    })
    const req = fakeIncomingMessage({
      method: 'GET',
      url: '/telemetry',
      headers: { authorization: `Bearer ${token}` },
    })
    const res = fakeServerResponse()

    await respond(req, res as unknown as ServerResponse, { store })

    expect(res.destroyedWith()).toBeInstanceOf(Error)
    expect(res.destroyedWith()?.message).toBe('scan broke (string)')
  })

  it('logs and destroys — never cleanly ends — the response when the socket write itself fails', async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const req = fakeIncomingMessage({ method: 'GET', url: '/nope' })
    const res = fakeServerResponse({ failWrite: true })
    const store = notImplementedStore()

    await respond(req, res as unknown as ServerResponse, { store })

    expect(res.isEnded()).toBe(false)
    expect(res.destroyedWith()?.message).toBe('write failed')
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('write failed'))
  })
})

describe('createServer (end-to-end over a real socket)', () => {
  const ADMIN_TOKEN = 'atl_admin_x_secret'
  const adminEnv = {
    ATEL_ADMIN_CREDENTIALS: Buffer.from(
      JSON.stringify([{ name: 'admin', token: ADMIN_TOKEN }]),
    ).toString('base64'),
  }

  async function withServer<T>(
    store: TelemetryStore,
    fn: (baseUrl: string) => Promise<T>,
  ): Promise<T> {
    const server = createServer({ store, env: adminEnv })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo
    try {
      return await fn(`http://127.0.0.1:${port}`)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }

  it('round-trips credentials -> append -> get through real HTTP against the in-memory store', async () => {
    await withServer(new MemoryTelemetryStore(), async (baseUrl) => {
      const created = (await fetch(`${baseUrl}/credentials`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'agent-1' }),
      }).then((r) => r.json())) as { token: string }
      expect(created.token).toMatch(/^atl_sk_/)

      const appended = await fetch(`${baseUrl}/telemetry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', agent: 'claude', data: { note: 'hi' } }),
      })
      expect(appended.status).toBe(201)

      const listed = (await fetch(`${baseUrl}/telemetry`, {
        headers: { authorization: `Bearer ${created.token}` },
      }).then((r) => r.json())) as Array<{ data: unknown }>
      expect(listed).toHaveLength(1)
      expect(listed[0]?.data).toEqual({ note: 'hi' })
    })
  })

  it('rejects a telemetry token on /credentials and an admin token on /telemetry (401)', async () => {
    await withServer(new MemoryTelemetryStore(), async (baseUrl) => {
      const { token: telemetryToken } = generateTelemetryToken()
      const credentialsWithTelemetryToken = await fetch(`${baseUrl}/credentials`, {
        headers: { authorization: `Bearer ${telemetryToken}` },
      })
      expect(credentialsWithTelemetryToken.status).toBe(401)

      const telemetryWithAdminToken = await fetch(`${baseUrl}/telemetry`, {
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      })
      expect(telemetryWithAdminToken.status).toBe(401)
    })
  })

  it('returns 401 for an unauthenticated /telemetry request and 404 for an unknown path', async () => {
    await withServer(new MemoryTelemetryStore(), async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/telemetry`)
      expect(unauthorized.status).toBe(401)

      const notFound = await fetch(`${baseUrl}/nope`)
      expect(notFound.status).toBe(404)
    })
  })
})
