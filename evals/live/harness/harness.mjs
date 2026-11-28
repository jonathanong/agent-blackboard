// Eval-only stand-in for a hosted agent-blackboard, bundled by scripts/run-evals-live.sh.
//
//   node harness.mjs serve        the server, started once per run on 127.0.0.1:$EVAL_HARNESS_PORT
//   node harness.mjs cli <args>   the real agent-blackboard CLI, pointed at that server
//   node harness.mjs mcp          the real MCP server, pointed at that server
//
// Every attempt gets its own blackboard. The cli and mcp modes send a token whose secret is the
// base64url of their working directory, and the server keeps that attempt's state in the
// workspace's `.eval-blackboard/`: `log.jsonl` holds every request that changed state, and each
// request replays it into a fresh in-memory store, so no state lives in the server process.
// After each request the server rewrites `.eval-blackboard/report.md` for the graders.
//
// The eval's sandboxed Bash cannot write files or open connections except through the sandbox's
// proxy, which is why the server runs outside the sandbox and owns the files. The URL and token
// are always the harness's own: whatever AGENT_BLACKBOARD_URL the caller has is never used.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { hashToken } from '../../../packages/server/src/auth/hash.mjs'
import { parseBearerToken } from '../../../packages/server/src/auth/parse-bearer.mjs'
import { parseClientToken } from '../../../packages/server/src/auth/tokens.mjs'
import { handleRequest } from '../../../packages/server/src/core/handle-request.mjs'
import { MemoryBlackboardStore } from '../../../packages/server/src/store/memory.mjs'
import { renderReport } from './report.mjs'

const CRED_ID = 'evalCredential000000ab'
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const port = Number(process.env.EVAL_HARNESS_PORT || 47811)
// An attempt's workspace is the `home/cwd` directory of a `claude plugin eval` temp directory.
const WORKSPACE = new RegExp(
  process.env.EVAL_HARNESS_WORKSPACE_RE || '^/tmp/claude-eval-[A-Za-z0-9]+/home/cwd(?=/|$)',
)

const tokenFor = (dir) => `abb_sk_${CRED_ID}_${Buffer.from(dir).toString('base64url')}`

function workspaceOf(authorization) {
  const token = parseBearerToken(authorization)
  const parsed = token && parseClientToken(token)
  if (!parsed || parsed.credId !== CRED_ID) return undefined
  const match = WORKSPACE.exec(Buffer.from(parsed.secret, 'base64url').toString('utf8'))
  return match && existsSync(match[0]) ? { token: tokenFor(match[0]), root: match[0] } : undefined
}

async function withLock(stateDir, fn) {
  mkdirSync(stateDir, { recursive: true })
  const lockPath = join(stateDir, 'lock')
  for (const started = Date.now(); ;) {
    try {
      mkdirSync(lockPath)
      break
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() - started > 60_000) throw error
      if (Date.now() - statSync(lockPath).mtimeMs > 30_000)
        rmSync(lockPath, { recursive: true, force: true })
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

async function collect(body) {
  const chunks = []
  for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function makeStore(token, clock) {
  const store = new MemoryBlackboardStore({ now: () => clock.at })
  const credential = {
    id: CRED_ID,
    name: 'eval',
    tokenHash: hashToken(token),
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  store.getCredentialById = async (id) => (id === CRED_ID ? credential : undefined)
  return store
}

async function replay(log, token, clock) {
  const store = makeStore(token, clock)
  for (const entry of log) {
    clock.at = new Date(entry.at)
    const headers = {
      authorization: `Bearer ${token}`,
      ...(entry.body ? { 'content-type': 'application/json' } : {}),
    }
    const request = {
      method: entry.method,
      path: entry.path,
      query: entry.query,
      headers,
      body: entry.body || undefined,
    }
    const response = await handleRequest(request, { store, now: () => clock.at, env: {} })
    await collect(response.body)
    if (response.status >= 400)
      throw new Error(`replay failed at ${entry.method} ${entry.path}: ${response.status}`)
  }
  return store
}

async function serve(incoming) {
  const workspace = workspaceOf(incoming.headers.authorization)
  if (!workspace)
    return {
      status: 401,
      headers: { 'content-type': 'application/json' },
      payload: '{"error":"not an eval workspace token"}',
    }
  const url = new URL(incoming.url ?? '/', 'http://localhost')
  const method = (incoming.method ?? 'GET').toUpperCase()
  const body = (await collect(incoming)).toString('utf8')
  const query = Object.fromEntries(url.searchParams)
  const headers = {}
  for (const [key, value] of Object.entries(incoming.headers))
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  // A command run from a subdirectory of the workspace still uses the workspace's blackboard.
  headers.authorization = `Bearer ${workspace.token}`
  const stateDir = join(workspace.root, '.eval-blackboard')
  const logPath = join(stateDir, 'log.jsonl')
  return withLock(stateDir, async () => {
    const log = existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : []
    const clock = { at: new Date(0) }
    const store = await replay(log, workspace.token, clock)
    clock.at = new Date(Math.max(Date.now(), log.length ? Date.parse(log.at(-1).at) + 1 : 0))
    const request = { method, path: url.pathname, query, headers, body: body || undefined }
    const response = await handleRequest(request, { store, now: () => clock.at, env: {} })
    const payload = await collect(response.body)
    if (MUTATING.has(method) && response.status < 400) {
      appendFileSync(
        logPath,
        `${JSON.stringify({ method, path: url.pathname, query, body, at: clock.at.toISOString() })}\n`,
      )
    }
    writeFileSync(join(stateDir, 'report.md'), await renderReport(store, CRED_ID))
    return { status: response.status, headers: response.headers, payload }
  })
}

function startServer() {
  const server = createServer((incoming, outgoing) => {
    serve(incoming).then(
      ({ status, headers, payload }) => outgoing.writeHead(status, headers).end(payload),
      (error) =>
        outgoing
          .writeHead(500, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: String(error) })),
    )
  })
  server.listen(port, '127.0.0.1', () =>
    process.stdout.write(`eval harness listening on 127.0.0.1:${port}\n`),
  )
}

const [mode, ...args] = process.argv.slice(2)
if (mode === 'serve') {
  startServer()
} else if (mode === 'cli' || mode === 'mcp') {
  // The CLI module runs itself when argv[1] is the file it was bundled into, so hide this
  // script's path before loading it.
  process.argv[1] = '/dev/null'
  const { runCli } = await import('../../../packages/agent-blackboard/src/cli/index.mjs')
  const env = {
    ...process.env,
    AGENT_BLACKBOARD_URL: `http://localhost:${port}`,
    AGENT_BLACKBOARD_TOKEN: tokenFor(process.cwd()),
  }
  delete env.AGENT_BLACKBOARD_ADMIN_TOKEN
  const code = await runCli(mode === 'mcp' ? ['mcp'] : args, { env })
  if (mode === 'cli') process.exit(code)
} else {
  process.stderr.write('usage: harness.mjs serve | cli <args> | mcp\n')
  process.exit(2)
}
