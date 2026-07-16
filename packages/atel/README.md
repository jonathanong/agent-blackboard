# @jongleberry/atel

Client library, CLI, and MCP server for [atel](https://github.com/jonathanong/atel) (Agent
Telemetry) — a telemetry stream for autonomous agents to record a stream of
consciousness while working unmonitored, then pull it back later to distill
learnings. This package is the piece you install; it talks to the
(separately deployed) atel HTTP service over `fetch` — no AWS SDK, no server
code.

```sh
npx @jongleberry/atel --help
```

## Install

```sh
pnpm add @jongleberry/atel
```

Requires Node 24+.

## Configuration

| Env var                  | Used by             | Meaning                                           |
| ------------------------ | ------------------- | ------------------------------------------------- |
| `ATEL_URL`               | CLI, MCP            | Base URL of the atel server                       |
| `ATEL_TOKEN`             | CLI, MCP            | Telemetry credential (`atl_sk_<credId>_<secret>`) |
| `ATEL_ADMIN_TOKEN`       | CLI (`credentials`) | Admin credential (`atl_admin_<name>_<secret>`)    |
| `CLAUDE_CODE_SESSION_ID` | session resolution  | Fallback session id (Claude Code)                 |
| `CODEX_THREAD_ID`        | session resolution  | Fallback session id (Codex)                       |

Telemetry and admin tokens are never interchangeable: `/telemetry` requires
a telemetry token, `/credentials` requires an admin token.

## CLI

```sh
atel append '{"note": "found a flaky retry in the payments worker"}'
atel append   # reads JSON from stdin if no argument is given

atel get                              # this session, format json (default)
atel get --format jsonl
atel get --format markdown
atel get --all-sessions --agent codex  # across every session for this credential
atel get --archived false

atel patch <id> --archived true
atel patch <id> --data '{"pr": 7777}'  # shallow-merged into existing data
atel patch --file patches.json         # batch: a JSON array of { id, archived?, data? }

atel credentials create --name "my laptop"   # admin-only; prints the token once
atel credentials list
atel credentials delete --name "my laptop"   # or --id <id>

atel mcp   # starts the MCP stdio server (see below)
```

Notes:

- `get` streams the raw response body straight to stdout as it arrives, in
  whatever format was requested — it never buffers the full response first,
  regardless of format.
- By default, `get` and `append` resolve the session id the same way (see
  [Session resolution](#session-resolution) below). Pass `--all-sessions` to
  `get` to skip that and read across every session visible to the credential.
- Output is JSON by default; `--format jsonl`/`--format markdown` are only
  meaningful for `get`.
- Exit code is `0` on success, `1` on any error, with a one-line
  `Error: ...` message on stderr — never a raw stack trace.

## Library

```ts
import { Telemetries, Telemetry, Auth } from '@jongleberry/atel'

// Telemetry — bound to one session + agent
const telemetry = new Telemetry({ baseUrl, token, agent: 'claude-code' }) // sessionId auto-resolved
await telemetry.append({ note: 'found a flaky retry' })
for await (const entry of telemetry.get({ archived: false })) {
  console.log(entry)
}

// Telemetries — cross-session operations
const telemetries = new Telemetries({ baseUrl, token })
await telemetries.append({ sessionId: 's1', agent: 'claude-code', data: { note: 'hi' } })
for await (const entry of telemetries.get({ agent: 'claude-code' })) {
  console.log(entry)
}
await telemetries.patch([
  { id: 'entry-1', archived: true },
  { id: 'entry-2', data: { pr: 7777 } }, // shallow merge, not a replace
])

// Auth — admin-only credential management (never exposed over MCP)
const auth = new Auth({ baseUrl, adminToken })
const { token: newToken } = await auth.createCredentials({ name: 'ci-bot' }) // shown once
await auth.listCredentials()
await auth.deleteCredentials({ name: 'ci-bot' }) // or { id }
```

Non-2xx responses throw `AtelError` (`status`, `body`).

### Streaming reads — an honest tradeoff

`Telemetry.get()` / `Telemetries.get()` return an `AsyncIterable<TelemetryEntry>`.
Under the hood, reads default to requesting the server's `jsonl`
(newline-delimited JSON) wire format and parse it **genuinely
incrementally**: each line is parsed and yielded as soon as it has fully
arrived off the `ReadableStream` reader, not after buffering the whole
response. This is the recommended default and what the library uses
internally wherever it needs entries (including the MCP server).

Pass `format: 'json'` to match the server's default array wire format
instead — this exists for parity, but a JSON array isn't a valid document
until its closing `]` arrives, so that path **buffers the full response**
before yielding anything. It is not genuinely incremental; prefer the
`jsonl` default.

The CLI's `get` command sidesteps this entirely for output purposes: it
never parses entries, it just relays the raw response body straight to
stdout as bytes arrive — so it's genuinely incremental for every format
(`json`, `jsonl`, `markdown` alike), since it never needs to wait for a
complete, parseable document.

## Session resolution

`resolveSessionId(explicit?, options?)` resolves the session id to record
telemetry under, in order:

1. An explicit id passed by the caller.
2. A hook-written state file at `.atel/session.json`, found by
   walking up from the current directory to the nearest ancestor containing
   `.git` (falling back to the current directory itself if none is found). A
   missing or unparsable file is treated as absent, not an error.
3. `CLAUDE_CODE_SESSION_ID`.
4. `CODEX_THREAD_ID`.
5. A generated id (`crypto.randomUUID()`), memoized for the lifetime of the
   current process.

Steps 2–4 are re-read fresh on every call (never cached) so a long-lived
process — like the MCP stdio server — picks up a state file rewritten by a
`SessionStart` hook (e.g. after `/clear`) without needing to restart. Only
the last-resort generated id is memoized, so repeated calls with no other
source agree on the same session for that process's lifetime.

## MCP server

```sh
atel mcp
```

A stdio MCP server exposing exactly three tools — deliberately **not**
credential management, which is CLI/admin-only:

- **`telemetry_append`** — `{ data: object, sessionId?: string, agent?: string }` → the created entry.
- **`telemetry_get`** — `{ sessionId?: string, agent?: string, archived?: boolean, format?: 'json' | 'jsonl' }` → `{ entries: TelemetryEntry[] }`.
  `sessionId` defaults to the current session (same resolution as `telemetry_append`), so "read back what I just recorded" needs no arguments.
- **`telemetry_patch`** — `{ patches: Array<{ id: string, archived?: boolean, data?: object }> }` → `{ patched: TelemetryEntry[] }`.

Reads reuse the same genuinely-incremental client internally, then collect
into the tool response — MCP tool results aren't naturally streaming to the
model.

Reads config from `ATEL_URL` / `ATEL_TOKEN`.

## License

MIT
