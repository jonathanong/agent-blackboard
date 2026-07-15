# Architecture

`agent-journal` is a journal for autonomous agents, not a knowledge base:
append-only, per-session, unstructured, and TTL'd. Agents write a stream of
consciousness while working unmonitored; they (or a distiller skill) pull it
back later to self-improve. This doc covers how the pieces fit together —
see [`cli.md`](cli.md), [`mcp.md`](mcp.md), and [`lambda.md`](lambda.md) for
command references.

## Repo layout

| Path                     | What                                                                                               | Published?                                |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `packages/server`        | The storage service: one Lambda (streaming Function URL) + one DynamoDB table                      | No — deployed via CloudFormation          |
| `packages/agent-journal` | The client library, CLI (`agent-journal`), and MCP server                                          | Yes — `@jongleberry/agent-journal` on npm |
| `plugins/agent-journal`  | Claude Code + Codex plugin: bundles the MCP server, a `SessionStart` hook, and a basic usage skill | No — installed via a plugin marketplace   |

## Request flow

```
agent / CLI / MCP tool
  → HTTP (fetch), Authorization: Bearer <token>
  → Lambda Function URL (InvokeMode: RESPONSE_STREAM)
  → src/handler.mts            (thin adapter: parse event, stream response)
  → src/core/handle-request.mts (framework-agnostic: auth → route → format)
  → src/store/{dynamo,memory}.mts
  → DynamoDB
```

`handler.mts` (Lambda) and `local-server.mts` (`node:http`, for local dev and
tests) are both thin adapters over the same `handleRequest(request, deps)`
core — neither knows about the other's transport. Responses stream back
chunk-by-chunk as they're produced in both cases; nothing buffers a full
result set before writing the first byte. A Lambda **Function URL** was
required specifically because streaming responses (`RESPONSE_STREAM`) aren't
available through API Gateway.

## Data model

One DynamoDB table (`PK`/`SK`, on-demand billing, TTL on the `ttl`
attribute), holding two kinds of item:

**Journal entry**

- `PK = <credId>` — a credential only ever sees its own entries
- `SK = <sessionId>#<entryId>` (`entryId` is a ULID-shaped, time-sortable id)
- Attributes: `credId`, `sessionId`, `agent`, `createdAt`, `archived`, `data`
  (an arbitrary JSON object — no imposed schema), `ttl` (epoch seconds,
  `createdAt + JOURNAL_TTL_DAYS`, default 90 days)

**Credential**

- `PK = "CRED"`, `SK = <credId>`
- Attributes: `name`, `tokenHash` (SHA-256 of the raw token — never the token
  itself), `createdAt`

Reads (`GET /journals`) `Query` by `PK` (optionally `begins_with(SK,
"<sessionId>#")` to scope to one session), paginate over
`ExclusiveStartKey`/`LastEvaluatedKey`, and stream results out as they're
fetched — never buffering the full result set.

`data` is intentionally unstructured. Agents attach whatever's useful —
branch names, PR numbers, notes — and filter/search client-side; the server
only understands `sessionId`/`agent`/`archived` as structured filters.
`PATCH` **merges** into `data` (shallow merge at the top level) rather than
replacing it, so entries can be enriched after the fact — e.g. tagging a
session's entries with a PR number once it exists.

## Auth model

Two credential types, deliberately never interchangeable:

|              | Journaling credential             | Admin credential                                        |
| ------------ | --------------------------------- | ------------------------------------------------------- |
| Token format | `ag_sk_<credId>_<secret>`         | `ag_admin_<name>_<secret>`                              |
| Stored       | DynamoDB (`tokenHash` only)       | Nowhere — lives only in the `ADMIN_CREDENTIALS` env var |
| Can call     | `/journals*`                      | `/credentials*`                                         |
| Created via  | `POST /credentials` (by an admin) | Set directly in server config                           |

A journaling token presented to `/credentials*`, or an admin token presented
to `/journals*`, is rejected outright (401) before any store lookup — there
is no code path where one credential type can act as the other. Token
comparisons are constant-time (`crypto.timingSafeEqual`) to avoid leaking
validity through timing. See [`lambda.md`](lambda.md#configuration) for how
`ADMIN_CREDENTIALS` is set.

## Session lifecycle

A journal entry's `sessionId` is meant to track the agent's own session, so
that starting a new session (e.g. running `/clear`, or a fresh Codex thread)
automatically starts a fresh journal stream — no manual reset needed.
Resolution order (`resolveSessionId`, re-read fresh on every call, never
cached — so a long-lived process like the MCP server picks up a rewritten
session file without restarting):

1. An explicit `sessionId` passed by the caller.
2. `.agent-journal/session.json` (gitignored), written by the plugin's
   `SessionStart` hook (`plugins/agent-journal/hooks/session-start.mjs`) on
   `startup`/`clear`/`resume`/`compact` — this is what makes session
   switches automatic, for both Claude Code and Codex (see caveat below).
3. `CLAUDE_CODE_SESSION_ID` env var.
4. `CODEX_THREAD_ID` env var.
5. A generated id (`crypto.randomUUID()`), memoized for the process's
   lifetime as a last resort.

**The hook, not the env var, is the reliable mechanism for Codex.** Step 4
exists as a cheap fallback, but don't rely on it: Codex does not currently
inject `CODEX_THREAD_ID` into local stdio MCP server processes at all
([openai/codex#19937](https://github.com/openai/codex/issues/19937)), and
even where the equivalent env var _is_ available to a shell/tool execution,
nested Codex sessions have been observed inheriting a parent thread's stale
id rather than their own
([openai/codex#15527](https://github.com/openai/codex/issues/15527)). In
practice, a Codex MCP server that never receives the hook-written state file
falls straight through to step 5 — one generated id memoized for the life of
the server process, which is only correct if Codex spawns a fresh MCP server
process per thread (an open question even in the upstream issue discussion,
not something this project can assume). Step 2 sidesteps the whole problem:
`plugins/agent-journal/.codex-plugin/hooks.json` registers the same
`session-start.mjs` script as a Codex plugin-bundled hook (Codex's hook
payload uses the same `session_id`/`cwd` field names Claude Code's does, so
one script covers both hosts), which keeps the state file fresh regardless
of `CODEX_THREAD_ID`'s reliability. The one real gap: Codex requires a
one-time manual trust step for plugin-bundled hooks — after installing the
plugin, run `/hooks` in Codex and trust `agent-journal`'s `SessionStart`
hook, or the hook is skipped and step 2 never fires. Claude Code's plugin
hooks did not surface an equivalent trust-gate in this project's testing,
but that wasn't exhaustively verified either — treat it as unconfirmed
either way, not as a guarantee.

## Streaming reads

`GET /journals` supports three wire formats (`json`, `jsonl`, `markdown`),
negotiated via `?format=` or `Accept`. The client library defaults to
requesting `jsonl` and parses it **genuinely incrementally** — each line is
yielded as soon as it fully arrives, never after buffering the whole
response. `format: json` (a single JSON array) is supported for parity but
can't be incrementally parsed (a JSON array isn't valid until its closing
`]` arrives), so that path buffers the full body first. The CLI sidesteps
this distinction entirely for `get`: it relays raw response bytes straight
to stdout as they arrive, so output is incremental regardless of format.

## What this project does not decide

`agent-journal` only handles _how_ entries are stored, retrieved, and
archived — not _what_ an agent should journal. That's left to
project-specific skills layered on top (see
[`plugins/agent-journal/skills/agent-journal/SKILL.md`](../plugins/agent-journal/skills/agent-journal/SKILL.md)
for a minimal starting point).
