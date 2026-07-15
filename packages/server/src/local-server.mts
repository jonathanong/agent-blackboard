// node:http adapter for local dev and for CLI/MCP integration tests to run
// against. Mirrors handler.mts's job for the Lambda side: translate between
// node:http's request/response shapes and the framework-agnostic
// handleRequest contract, streaming the response back with res.write()/
// res.end() as chunks land — genuine streaming, not buffer-then-send.
//
// Run directly via `node local-server.mts` (the package's `dev` script runs
// it through tsx). JOURNAL_STORE=memory swaps in an in-memory store — no
// AWS account needed for local dev (see README).
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { AdminEnv } from './auth/admin.mjs'
import { handleRequest } from './core/handle-request.mjs'
import type { BodyChunk, HandlerRequest, HandlerResponse } from './core/types.mjs'
import { createDynamoStore } from './store/dynamo.mjs'
import { MemoryJournalStore } from './store/memory.mjs'
import type { JournalStore } from './store/store.mjs'

export interface ServerDeps {
  store: JournalStore
  now?: () => Date
  env?: AdminEnv
}

// ---- Pure request/response adapting (unit-testable without a live socket) ----

export function parseIncomingRequest(req: IncomingMessage): HandlerRequest {
  const method = (req.method ?? 'GET').toUpperCase()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const query: Record<string, string | undefined> = {}
  for (const [key, value] of url.searchParams) query[key] = value // repeated keys: last wins (iteration order)
  return { method, path: url.pathname, query, headers: normalizeHeaders(req.headers), body: req }
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) normalized[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return normalized
}

function writeChunk(res: ServerResponse, chunk: BodyChunk): Promise<void> {
  return new Promise((resolve, reject) => {
    res.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logError(msg: string, error: unknown): void {
  console.error(JSON.stringify({ level: 'error', msg, error: errorMessage(error) }))
}

export function currentTime(): Date {
  return new Date()
}

// ---- Core adapter logic (fully unit-testable via injected deps + a real IncomingMessage/ServerResponse pair) ----

export async function respond(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  let response: HandlerResponse
  try {
    const request = parseIncomingRequest(req)
    response = await handleRequest(request, {
      store: deps.store,
      now: deps.now ?? currentTime,
      env: deps.env ?? {},
    })
  } catch (error) {
    // Nothing has been written to `res` yet at this point (writeHead is
    // only reached below, once handleRequest has already resolved) — always
    // safe to respond 500 directly, unlike the streaming catch below.
    logError('handleRequest threw', error)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'internal_error' }))
    return
  }

  try {
    res.writeHead(response.status, response.headers)
    for await (const chunk of response.body) await writeChunk(res, chunk)
  } catch (error) {
    // Covers both a `writeHead` failure (nothing sent yet) and a mid-stream
    // failure (status/headers already sent, so we can't change them now) —
    // either way we can only log and make sure the socket closes.
    logError('error while streaming response body', error)
  } finally {
    res.end()
  }
}

export function createServer(deps: ServerDeps): Server {
  return createHttpServer((req, res) => {
    /* v8 ignore start -- last-resort backstop: respond() already catches
     * every error reachable through normal HTTP traffic (see its own
     * try/catches); this only fires if e.g. `res.end()` itself throws
     * inside respond()'s `finally`, which isn't reproducible without
     * corrupting the socket in ways no real client can trigger. */
    respond(req, res, deps).catch((error: unknown) => {
      logError('unhandled error responding to request', error)
      res.destroy()
    })
    /* v8 ignore stop */
  })
}

// ---- Script entrypoint: `node local-server.mts` / `pnpm run dev` ----

export function adminEnvFromProcess(): AdminEnv {
  return process.env.ADMIN_CREDENTIALS ? { ADMIN_CREDENTIALS: process.env.ADMIN_CREDENTIALS } : {}
}

export function storeFromProcess(): JournalStore {
  return process.env.JOURNAL_STORE === 'memory' ? new MemoryJournalStore() : createDynamoStore()
}

/* v8 ignore start -- script entrypoint: only runs under `node local-server.mts`
 * (`pnpm run dev`) or a real subprocess of it, not under vitest. The logic it
 * wires together (createServer, storeFromProcess, adminEnvFromProcess) is
 * fully covered above/via the exported helpers; this block is just glue +
 * console output. See README for manual verification steps. */
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  const usingMemory = process.env.JOURNAL_STORE === 'memory'
  const server = createServer({ store: storeFromProcess(), env: adminEnvFromProcess() })
  server.listen(port, () => {
    console.log(
      `agent-journal local server listening on http://localhost:${port} (store: ${usingMemory ? 'memory' : 'dynamodb'})`,
    )
  })
}
/* v8 ignore stop */
