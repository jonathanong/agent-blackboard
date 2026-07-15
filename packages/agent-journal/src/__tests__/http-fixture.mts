import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Shared `node:http` test fixture used across client/CLI/MCP tests, so the
 * HTTP client is exercised against a real socket (real streaming included)
 * without depending on the (separately developed) server package.
 */
interface FixtureRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

export type FixtureHandler = (
  request: FixtureRequest,
  response: ServerResponse,
) => void | Promise<void>

export interface HttpFixture {
  baseUrl: string
  requests: FixtureRequest[]
  close: () => Promise<void>
}

/** Starts a local HTTP server on an ephemeral port, recording every request. */
export async function startHttpFixture(handler: FixtureHandler): Promise<HttpFixture> {
  const requests: FixtureRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const request: FixtureRequest = {
        method: req.method as string,
        url: req.url as string,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(request)
      void handler(request, res)
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/** Writes a JSON body with the given status and `content-type: application/json`. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** Streams entries as newline-delimited JSON, one `write()` per entry (genuine chunking). */
export function sendNdjson(response: ServerResponse, entries: unknown[]): void {
  response.writeHead(200, { 'content-type': 'application/x-ndjson' })
  for (const entry of entries) {
    response.write(`${JSON.stringify(entry)}\n`)
  }
  response.end()
}
