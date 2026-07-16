# Agent hosts: Claude Code & Codex

`atel` ships as a plugin for both Claude Code and Codex. The two hosts share a lot of
surface area (MCP registration, a `SessionStart` hook with an identical payload shape) but diverge
in real, tested ways. This is the practical reference for maintaining dual-host support — what's
shared, what differs, the gotchas hit while building this, and recommendations. For the underlying
session-resolution algorithm and code, see
[`architecture.md#session-lifecycle`](architecture.md#session-lifecycle); for the MCP tool API,
see [`mcp.md`](mcp.md).

## How it works

### Shared: MCP server + `SessionStart` hook

- Both hosts run `atel mcp` (stdio), configured by `plugins/atel/.mcp.json`,
  reading `ATEL_URL`/`ATEL_TOKEN` from the environment.
- Both hosts support a `SessionStart` hook with matchers `startup|clear|resume|compact`, and send
  `session_id`/`cwd` on stdin using the same field names — so **one script**,
  `plugins/atel/hooks/session-start.mjs`, covers both. It writes
  `.atel/session.json` in the working directory.
- The published package's `resolveSessionId()`
  (`packages/atel/src/session.mts`) is host-agnostic: explicit id passed by the caller →
  the hook's state file (found by walking up from `cwd` to the nearest ancestor containing `.git`)
  → `CLAUDE_CODE_SESSION_ID` → `CODEX_THREAD_ID` → a generated id memoized for the process's
  lifetime. The file is re-read fresh on every call (never cached), so a long-lived MCP server
  process picks up a hook-rewritten session without restarting.

### Claude Code specifics

- Manifest: `.claude-plugin/plugin.json` (repo root) + `.claude-plugin/marketplace.json`.
- `${CLAUDE_PLUGIN_ROOT}` resolves to the **repo root** — so `hooks/hooks.json`'s command path is
  the full path from there:
  `${CLAUDE_PLUGIN_ROOT}/plugins/atel/hooks/session-start.mjs`.
- MCP-in-plugin registration is an `mcpServers` key in `.claude-plugin/plugin.json` pointing at a
  `.mcp.json` file (not an inline object) — confirmed working via `claude mcp list`.
- Install for local testing: `claude plugin marketplace add <path>` then
  `claude plugin install atel@<marketplace-name>`. Non-interactive dispatch for testing:
  `claude -p`.

### Codex specifics

- Manifest: `plugins/atel/.codex-plugin/plugin.json` +
  `.agents/plugins/marketplace.json` (repo root).
- `${PLUGIN_ROOT}` resolves to the **plugin subfolder** (`plugins/atel/`), not the repo
  root — a compat alias for the same kind of variable Claude Code has, but scoped differently. This
  is why there's a **separate** `.codex-plugin/hooks.json` with its own relative path
  (`${PLUGIN_ROOT}/hooks/session-start.mjs`) instead of reusing Claude Code's `hooks/hooks.json` —
  the same literal path string cannot work for both hosts.
- Requires a one-time manual trust step: after installing, run `/hooks` in Codex and trust
  `atel`'s `SessionStart` hook, or it is silently skipped.
- Non-interactive dispatch for testing: `codex exec` (spawns a fresh subprocess per invocation).

## Gotchas

Everything below was found by actually dispatching real Codex/Claude Code agents against this
plugin (see [`smoke-test.md`](smoke-test.md) for the full run log), not just from reading the
hosts' docs.

1. **`${CLAUDE_PLUGIN_ROOT}` vs `${PLUGIN_ROOT}` scope divergence.** Claude Code's variable
   resolves to the repo root; Codex's resolves to the plugin subfolder. The same hooks manifest
   can't work for both — hence the two separate files (see above).
2. **Codex's `mcpServers`/`hooks` override keys in `plugin.json` didn't appear to change what
   `codex mcp get` resolved** in testing — pointing them at a different file had no observed
   effect; Codex kept reading the default-location files regardless. This contradicts Codex's own
   plugin documentation, so treat it as a possible CLI-version bug, not a confirmed permanent
   limitation — re-check after any `codex` CLI upgrade. A later run made "the default location" concrete
   for hooks specifically: installing this plugin logged
   `failed to read plugin hooks config <plugin-root>/hooks.json: No such file or directory` — a flat
   `hooks.json` directly at the plugin root, which is neither this project's actual default
   (`hooks/hooks.json`) nor its Codex-specific override target (`.codex-plugin/hooks.json`). `mcpServers`
   has still round-tripped successfully in every test, most likely because `.mcp.json` already happens
   to sit at the plugin root (Codex's presumed default location) regardless of the override — a lucky
   coincidence of this project's file layout, not evidence the override itself works.
3. **Codex's `env` field in `.mcp.json` doesn't template `${VAR}`** — it's passed through as a
   literal string, not substituted. The documented mechanism is `env_vars` (a whitelist array of
   names to pass through), not `env`. This was never cleanly isolated in testing (see gotcha #4
   below confounded one attempt), so treat "does `env_vars` work" as unconfirmed, not disproven.
4. **`codex exec` spawns via a login shell (`zsh -lc`) that re-sources `~/.zshrc`.** Any real
   deployment's credentials already exported there silently win over whatever you export in your
   own calling shell — a test can end up talking to production instead of a sandbox. Confirmed
   harmless once (the client failed closed on a malformed URL before any network call went out),
   but don't assume that safety net every time: always check the dispatched agent's actual shell
   profile for pre-existing `ATEL_*` vars before trusting your own exported test values
   reached it.
5. **The `SessionStart` hook has never been confirmed to actually fire for Codex at all** — every
   session-boundary test that "passed" did so via per-process fallback isolation (see gotcha #6),
   not a confirmed-working hook, and the missing-hooks-config error in gotcha #2 above means the
   hook config likely never even loads, let alone reaches a trust decision. An earlier version of
   this doc attributed that to Codex's manual `/hooks` trust step being skipped — that's still worth
   doing after any install, but given gotcha #2, trust was probably never the actual gate here. Don't
   claim the hook works for Codex until a run confirms the hook's own state-file write, the same way
   it's been confirmed for Claude Code (see [`smoke-test.md`](smoke-test.md)).
6. **`CODEX_THREAD_ID` is not reliably injected into local stdio MCP server processes**
   ([openai/codex#19937](https://github.com/openai/codex/issues/19937)), and even where it is
   present, nested Codex sessions have been observed inheriting a parent thread's stale id rather
   than their own ([openai/codex#15527](https://github.com/openai/codex/issues/15527)). Don't rely
   on it — the `SessionStart` hook is the only reliable mechanism for Codex.
7. **Subagent session attribution diverges by host — confirmed, not incidental.** A Codex
   `codex exec` subagent gets its **own independent** session id. A Claude Code Task-tool subagent
   **shares its parent's** session id. Neither is a bug; it's a real behavioral difference between
   the two hosts' subagent mechanisms. Anything that assumes one behavior (e.g. "a subagent's
   telemetry entries land in their own session") will be wrong on the other host.
8. **`claude plugin details` can report "MCP servers (0)" even when the server is genuinely
   connected and working.** Confirmed via `claude mcp list` showing `✔ Connected` and the tools
   succeeding end-to-end in the same test run. Treat that one command's server count as an
   unreliable display detail, not a health check.

## Recommendations

- **Never rely on `CLAUDE_CODE_SESSION_ID`/`CODEX_THREAD_ID` alone.** Ship the `SessionStart` hook
  and treat it as the source of truth — it's the only mechanism confirmed reliable on both hosts,
  and the _only_ reliable one on Codex specifically.
- **When testing against a real dispatched agent, hardcode literal test values** into `.mcp.json`'s
  `env` field rather than `${VAR}` templates or ambient shell inheritance, and check the dispatched
  agent's actual shell profile (`~/.zshrc`, etc.) for a pre-existing real deployment's credentials
  first (gotcha #4).
- **Don't assume subagent session behavior generalizes across hosts.** If a feature depends on it,
  test explicitly against both Claude Code's Task tool and Codex's `codex exec`/nested-exec
  mechanism — don't extrapolate from one to the other (gotcha #7).
- **Run `/hooks` and trust the hook after installing the Codex plugin, but don't assume that's
  sufficient** — it may not even be the actual gate (gotcha #5). Before relying on the hook for
  Codex, confirm it fired for real by checking `.atel/session.json`'s content directly, the
  same way it's been confirmed for Claude Code — don't infer it from a correct-looking session
  boundary, which fallback isolation can produce for the wrong reason.
- **Use `claude mcp list`, not `claude plugin details`, to check whether the MCP server is actually
  connected** (gotcha #8).
- **Re-check gotchas #2 and #3 after any Codex CLI upgrade** — both were logged as possible
  version-specific bugs, not confirmed permanent limitations.
- **Log every real dispatch-test run in [`smoke-test.md`](smoke-test.md)'s prior-run log**,
  including this doc's own gotchas if a re-run contradicts one of them — this doc and that one
  should never drift apart.
