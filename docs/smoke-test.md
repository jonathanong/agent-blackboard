# Agent smoke test

A prompt to hand a real agent (Claude Code or Codex) so it exercises
`agent-journal` end to end — not just the happy path, but specifically the
things automated tests can't observe: whether a real session-boundary event
(`/clear`, or Codex's equivalent) actually starts a fresh journal stream,
whether a subagent's journal entries land in the same session as its parent
or a different one, and — via the CLI variant below — whether any of that
changes when the agent shells out to `agent-journal` directly instead of
going through the MCP server. All three were open questions flagged in
[`architecture.md#session-lifecycle`](architecture.md#session-lifecycle);
real runs (see [Prior run log](#prior-run-log)) have since answered the
session-boundary and MCP subagent questions empirically, but treat each as
one data point per host/interface, not a universal guarantee — the CLI
variant in particular has no real run on record yet for either host.

This covers two genuinely different code paths, not one prompt run twice:
the **MCP interface** (`journal_append`/`journal_get`/`journal_patch`, via
whatever MCP server the plugin registered) and the **CLI interface**
(`agent-journal append|get|patch`, a separate process invoked directly from
the agent's own shell). They share the same session-resolution logic, but
the CLI has no persistent server process and reads its env vars from
whatever shell environment invokes it each time — run both variants, don't
assume a pass on one implies a pass on the other.

## Before dispatching

- The agent needs the `agent-journal` plugin installed for its host, and a
  **fresh client/journaling credential** (`AGENT_JOURNAL_TOKEN`, `ag_sk_...`)
  set — never the admin token. Create one against a running server (local or
  deployed) with `agent-journal credentials create --name "smoke-test"`
  using an **admin** token, then hand only the resulting `ag_sk_...` token
  and `AGENT_JOURNAL_URL` to the agent being tested.
- **Check for a pre-existing `AGENT_JOURNAL_URL`/`AGENT_JOURNAL_TOKEN` in the
  dispatched agent's actual runtime shell profile** (`~/.zshrc`, `~/.bashrc`,
  etc.) before assuming your own exported test values will reach it. `codex
exec` in particular spawns its subprocesses via a **login shell**
  (`zsh -lc`), which re-sources the real shell profile — if a real
  deployment's credentials already live there (yours might; check first),
  they silently win over whatever you exported in your own calling shell,
  and the test talks to production instead of your sandbox. The one
  mechanism confirmed to sidestep this reliably: set the plugin's MCP
  server config (`.mcp.json` / the Codex plugin's resolved config) to
  **literal, hardcoded test values** rather than `${VAR}` templates or
  relying on ambient inheritance, for the duration of the test only —
  revert afterward.
- **Codex specifically**: after installing the plugin, run `/hooks`, review
  `agent-journal`'s `SessionStart` hook, and trust it. If this step is
  skipped, the hook never fires — expect phase 3 to fall back to
  per-process session isolation instead (see [Prior run
  log](#prior-run-log); this has so far produced the same observable
  outcome, but for a different reason than the hook actually working).
  Separately, `.codex-plugin/plugin.json`'s `mcpServers`/`hooks` override
  keys were not observed to change what `codex mcp get` resolves in the
  Codex CLI version tested — if your dispatched agent's config doesn't
  match what you edited, that's a known, unexplained gap, not something
  you're doing wrong.
- **Testing the CLI variant specifically**: the CLI reads
  `AGENT_JOURNAL_URL`/`AGENT_JOURNAL_TOKEN` from whatever shell environment
  the `agent-journal` process inherits at invocation time — unlike the MCP
  server, which gets its env from `.mcp.json` regardless of the dispatched
  agent's own shell. Have the agent prefix **every single CLI invocation**
  with explicit inline values
  (`AGENT_JOURNAL_URL=... AGENT_JOURNAL_TOKEN=... agent-journal append ...`)
  rather than exporting them once and trusting they persist — an inline
  per-command prefix always wins even if a login shell re-sources
  `~/.zshrc` between commands (see the gotcha above), but a one-time
  `export` doesn't reliably survive that. Before publishing, use the
  locally built CLI: `pnpm exec agent-journal <args>` from the repo root
  (see repo `CLAUDE.md`), or
  `node packages/agent-journal/dist/cli/index.mjs <args>` directly.

## The prompt (MCP interface)

Copy-paste this to the agent being tested:

> You're smoke-testing an MCP tool called `agent-journal`. Work through
> these phases in order, and at the end report a structured summary — for
> every step, state which tool you called, its arguments, and its raw
> result (especially any `sessionId` values you observe). Don't summarize
> away the session ids; they're the point of this test.
>
> **Phase 0 — sanity check.** Before doing anything else, confirm what
> server you're actually configured to talk to (e.g. check the env var or
> config your `agent-journal` MCP server was given, if you can see it) and
> report it. If it doesn't match the `AGENT_JOURNAL_URL` you were told to
> expect, stop and report the mismatch instead of proceeding — you may be
> pointed at a real deployment instead of the intended test sandbox.
>
> **Phase 1 — basic round trip.** Call `journal_append` with
> `{"data": {"marker": "smoke-test-phase-1"}}`. Then call `journal_get` with
> no arguments (session-scoped, no `archived` filter) and confirm the
> phase-1 entry comes back. Report the `sessionId` on that entry.
>
> **Phase 2 — patch.** Call `journal_patch` to set
> `{"data": {"pr": 9999}}` merged onto the phase-1 entry (by its `id`), and
> confirm via another `journal_get` that `data.marker` is still
> `"smoke-test-phase-1"` _and_ `data.pr` is now `9999` on the same entry
> (a merge, not a replace).
>
> **Phase 3 — session boundary.** Now reset your session context: if you're
> Claude Code, run `/clear`. If you're Codex, start a genuinely new
> thread/session (not a resume of this one) — a fresh `codex exec`
> invocation is the simplest way to guarantee this. In that new session,
> call `journal_append` with `{"data": {"marker": "smoke-test-phase-3"}}`,
> then `journal_get` with no arguments. Report: does this `journal_get` show
> the phase-1/phase-2 entry, or only phase-3? Report both entries'
> `sessionId` values. (Expected: only phase-3, with a different `sessionId`
> than phase 1's.)
>
> **Phase 4 — subagent attribution.** From your current (phase-3) session,
> dispatch a subagent — in Claude Code, use the Task/Agent tool; in Codex,
> use whatever subagent/nested-execution mechanism you have (a nested
> `codex exec`, a Task tool, etc.). Have the subagent call `journal_append`
> with `{"data": {"marker": "smoke-test-subagent"}}` itself (not you, on its
> behalf) and report the `sessionId` it got back to you. Then, from the
> parent, call `journal_get` again and report whether the subagent's entry
> shares the parent's phase-3 `sessionId` or has a different one. (One prior
> `codex exec` run saw the subagent get its own independent session id —
> confirm whether that holds here too, don't assume it.)
>
> **Report.** Summarize: every `sessionId` observed across all five phases,
> whether phase 3 correctly started a new session, whether the phase-4
> subagent entry matched or diverged from its parent's session, and
> anything that errored, required manual approval (e.g. a hook-trust
> prompt), or otherwise surprised you.

## The prompt (CLI interface)

Same four phases, but shelling out to `agent-journal` directly instead of
calling MCP tools — a genuinely different code path (its own env-var
reading, a fresh process per invocation, no persistent server). Copy-paste
this to the agent being tested; read [Before dispatching](#before-dispatching)'s
CLI note first:

> You're smoke-testing the `agent-journal` CLI (not its MCP server — run
> every command below directly in your shell, prefixing each one with
> explicit `AGENT_JOURNAL_URL=...` and `AGENT_JOURNAL_TOKEN=...` values
> rather than relying on already-exported ones). Work through these phases
> in order, and at the end report a structured summary — for every step,
> state the exact command you ran and its raw output, especially any
> `sessionId` values.
>
> **Phase 0 — sanity check.** Run `agent-journal get` once before doing
> anything else and confirm it talks to the server you expect (check the
> `AGENT_JOURNAL_URL` you're passing matches what you were told to expect).
> If it doesn't, stop and report the mismatch — you may be pointed at a
> real deployment instead of the intended test sandbox.
>
> **Phase 1 — basic round trip.** Run
> `agent-journal append '{"marker": "smoke-test-cli-phase-1"}'`. Then run
> `agent-journal get` and confirm the phase-1 entry comes back. Report the
> `sessionId` on that entry.
>
> **Phase 2 — patch.** Run `agent-journal patch <id> --data '{"pr": 9999}'`
> for the phase-1 entry's `id`, then `agent-journal get` again and confirm
> `data.marker` is still `"smoke-test-cli-phase-1"` _and_ `data.pr` is now
> `9999` on the same entry (a merge, not a replace).
>
> **Phase 3 — session boundary.** Reset your session context exactly as in
> the MCP variant's phase 3 (`/clear` for Claude Code; a genuinely new
> `codex exec` thread for Codex — not a resume). In the new session, run
> `agent-journal append '{"marker": "smoke-test-cli-phase-3"}'`, then
> `agent-journal get`. Report: does this show only phase-3, or also
> phase-1/2? Report both entries' `sessionId` values. (Expected: only
> phase-3, with a different `sessionId`.)
>
> **Phase 4 — subagent attribution.** From your current (phase-3) session,
> dispatch a subagent (Task tool for Claude Code; a nested `codex exec` or
> equivalent for Codex). Have the subagent run
> `agent-journal append '{"marker": "smoke-test-cli-subagent"}'` **itself**,
> via its own shell — not you, on its behalf — and report the `sessionId`
> it got back. Then, from the parent, run `agent-journal get` again and
> report whether the subagent's entry shares the parent's phase-3
> `sessionId` or has a different one. Unlike the MCP variant (where this is
> known to diverge by host — see [Prior run log](#prior-run-log)), the CLI
> has no persistent server process for a subagent to reuse or reconnect
> to — the working hypothesis is that CLI-based subagent journaling
> **always** shares the parent's session, on both hosts, because session
> resolution just reads the same `.agent-journal/session.json` file
> regardless of which process invokes it. Confirm or refute this, don't
> assume it.
>
> **Report.** Summarize: every `sessionId` observed across all four phases,
> whether phase 3 correctly started a new session, whether the phase-4
> subagent entry matched or diverged from its parent's session, and
> anything that errored (especially an auth or URL error, which likely
> means an inline env var prefix didn't actually take effect — see
> [Interpreting the results](#interpreting-the-results)) or otherwise
> surprised you.

## Interpreting the results

- **Phase 0 failing (wrong server)** means the dispatch setup is wrong, not
  the tool — fix the agent's env/config before drawing any conclusion from
  the rest of the phases.
- **Phases 1–2 failing** is a real regression — file it against this repo.
- **Phase 3 showing the old entry** means neither the `SessionStart` hook
  nor per-process fallback isolation kicked in — session resolution fell
  through to a stale hook state file or a cached generated id. Check
  hook-trust status first (Codex), or whether `/clear` genuinely started a
  new process (Claude Code).
- **Phase 4's outcome diverging from the one prior data point is itself
  interesting** — it would mean this host/version/subagent-mechanism
  combination attributes subagent work differently than the one `codex
exec` run on record. Either outcome is informative; record whichever you
  observe (in a journal entry, fittingly) rather than assuming the prior
  result generalizes.
- **CLI variant failing with an auth or URL error on phase 0/1** almost
  always means an inline env var prefix didn't actually take effect —
  before concluding it's a real bug, have the agent print exactly what
  `AGENT_JOURNAL_URL`/`AGENT_JOURNAL_TOKEN` resolved to in that specific
  command's shell invocation (not just what you told it to export).
- **CLI variant's phase 4 NOT sharing the parent's session would be the
  surprising outcome** — the opposite framing from the MCP variant. The
  CLI has no persistent server process, so there's no known mechanism for
  a subagent's separate `agent-journal` invocation to get a different
  session than whatever `.agent-journal/session.json` already says. If it
  does diverge, that's a real, unexplained finding worth digging into
  (e.g. a subagent running from a different `cwd` that resolves a
  different project root) rather than assuming the CLI works like MCP.

## Prior run log

**2026-07-15, `codex-cli` on macOS, local in-memory server, plugin installed
as a local Codex marketplace source.** Phases 1–2 passed for real (append →
get → patch-merge → get, one consistent `sessionId`). Phase 3 passed, but
via per-process fallback isolation rather than a confirmed-working hook —
each fresh `codex exec` is a fresh MCP server process with its own
generated id, which produces the right observable outcome regardless of
whether the hook itself fired. Phase 4: the dispatched subagent got its own
independent session id, different from its parent's.

Also surfaced along the way (not phase failures, but real integration
gaps): the Codex plugin's `mcpServers`/`hooks` manifest override keys didn't
appear to change what `codex mcp get` resolved, and `codex exec`'s
login-shell subprocess spawning re-sourced a real, separately-deployed
instance's credentials from `~/.zshrc` mid-test (confirmed harmless — the
client fails closed with a synchronous "Invalid URL" before any network
call, rather than silently writing anywhere). Full account in
[`architecture.md#session-lifecycle`](architecture.md#session-lifecycle).

**2026-07-15, `claude` CLI on macOS, local in-memory server, plugin
installed as a local Claude Code marketplace source.** Phases 1–2 passed
for real (append → get → patch-merge → get, one consistent `sessionId`
throughout, dispatched via `claude -p --output-format json
--dangerously-skip-permissions`). Phase 3 passed with a genuinely fresh
session id and no leakage from the phase-1/2 session — and this time the
`SessionStart` hook was confirmed to have actually fired, not just
inferred from a correct outcome: `.agent-journal/session.json` was read
directly after the dispatch and its content matched the new session id
exactly. Phase 4 diverged from the Codex data point above: the dispatched
Task-tool subagent's `journal_append` call shared its parent's session id
rather than getting an independent one — the opposite of `codex exec`'s
subagent behavior. This is the interesting divergence phase 4's own
write-up anticipated; see
[`architecture.md#session-lifecycle`](architecture.md#session-lifecycle)
for the full account.

Also surfaced along the way: `claude plugin details` reported "MCP
servers (0)" for the installed plugin even though `claude mcp list` showed
it connected and the tool calls worked correctly end-to-end — an apparent
display bug in that one command, not a functional gap.
