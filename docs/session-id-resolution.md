# Session-id resolution

The server never infers or generates session ids. The client package (library, CLI, and MCP
server) can resolve one for a caller that omits it, so consumers running inside a coding-agent
harness don't each have to reimplement the same detection and persistence logic.

An explicit id always wins and is sent as-is. The server validates it with its own rule: URL-safe
letters, numbers, `.`, `_`, `:`, and `-`.

## Resolution order

`resolveSessionIdentity({ env, cwd, ... })` returns `{ agent, harness, sessionId? }`, or
`undefined` when nothing identifies a harness. It never reads `process.env` or `process.cwd()`
itself.

1. **Explicit `sessionIdArg`.** Used as-is. The harness it is paired with is the one whose env id
   matches it, then a Grok hook event, then the `runtime` hint, then ambient resolution, then the
   transcript hint.
2. **`rootCodex`.** Reads or mints the worktree's root Codex id (see below).
3. **Environment markers.** `CLAUDE_CODE_SESSION_ID` comes first. In Claude-compat mode
   (`CLAUDECODE=1`, which Cursor and Grok also set), Grok and Codex ids are trusted only when
   unambiguous. Otherwise the order is `GROK_SESSION_ID`/`GROK_HOOK_EVENT` (unless
   `CODEX_THREAD_ID` is also set), then the `runtime` hint, then `CODEX_THREAD_ID`, then
   `GROK_SESSION_ID`, then `CURSOR_SESSION_ID`.
4. **Per-worktree persisted id.** `.local/grok-session-id` when `GROK_AGENT` is set, otherwise
   `.local/cursor-session-id`.
5. **Transcript path hint.** `~/.codex/**/*.jsonl`, `~/.grok/**/updates.jsonl`, or
   `~/.claude/projects/**/*.jsonl` give the agent but no id.
6. **Agent markers.** `GROK_AGENT` or `CURSOR_AGENT` give the agent but no id.

A leftover persisted file never overrides a transcript hint that names a different harness.
Resolved ids (from env, files, or hook payloads) must match `^[a-zA-Z0-9_-]+$`, because consumers
use them in glob patterns and file paths. `requireSessionId` and `requireSessionIdentity` throw
when no valid id resolves.

`inspectHarnessEnvironment(env)` reads the raw marker table, and `selectHarnessSession(environment,
precedence)` picks one harness. `HARNESS_SESSION_PRECEDENCE` is codex, then claude, then cursor,
then grok. Neither function throws. Pass `inspectEnvironment` to `resolveSessionIdentity` to
replace the built-in detection.

## Per-worktree persistence

Cursor, Grok, and an interactive root Codex process don't expose their id to every child process,
so it is written to `<worktree>/.local/<harness>-session-id`: one id and a trailing newline. The
worktree root is the nearest ancestor of `cwd` that contains `.git`. Every persistence function
normalizes the directory it is given to that root, so reads and writes from any subdirectory use
the same file.

- Hook callers use `persistHookSessionStart` and `persistHookRealSessionId`, which take a plain
  `Record<string, unknown>` payload (`session_id`, `sessionId`, and for Cursor `conversation_id`).
  When a SessionStart payload has no valid id and nothing is persisted, `persistHookSessionStart`
  mints and writes `<harness>-<uuid>`. Later hooks only overwrite the file with a real id. Write
  failures are swallowed so hooks never fail closed.
- **Root Codex:** `--root-codex` adopts `CODEX_THREAD_ID` when it is set, otherwise reuses the
  persisted id, otherwise mints `codex-<uuid>`. `--new-root-codex-session` ignores the persisted id
  and mints a fresh one. Write and read-back failures surface as errors here.
- **One file per harness per worktree.** Two Cursor or Grok sessions running in the same worktree
  share `.local/<harness>-session-id`, so the most recent SessionStart wins. Give concurrent
  sessions separate worktrees, or pass explicit ids.

## CLI and MCP

- `append` and `get` accept an omitted `--session-id`. `sessions create|ensure` accept an omitted
  `<session-id>` and/or `--agent`. Missing values are resolved as a pair, from the same harness.
- `--root-codex` and `--new-root-codex-session` are bare flags. They can't be combined with
  `--session-id`, the positional id, or `--parent-session-id`, and `--root-codex` requires
  `--agent codex` when `--agent` is given.
- The MCP tools `entry_append`, `entry_get`, `session_create`, and `session_ensure` accept an
  omitted `sessionId` (and `agent` for the session tools). These are resolved from the MCP server
  process's own environment and working directory. `session_patch` and `session_archive` still
  require an explicit `sessionId`.

Prefer explicit ids when an agent already knows its id, and always use explicit ids for
subagents. Each subagent needs its own session, but it inherits its parent's environment. The MCP
server resolves from the environment it was launched with, so it can't see a session id that
changes later in the same process (for example after a `/clear`). Pass an explicit `sessionId`
once the host's id may have changed.
