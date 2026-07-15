# Agent smoke test

A prompt to hand a real agent (Claude Code or Codex) so it exercises
`agent-journal` end to end — not just the happy path, but specifically the
two things automated tests can't observe: whether a real session-boundary
event (`/clear`, or Codex's equivalent) actually starts a fresh journal
stream, and whether a subagent's journal entries land in the same session as
its parent or a different one. Both are open questions flagged in
[`architecture.md#session-lifecycle`](architecture.md#session-lifecycle) —
this test gathers real data on them rather than asserting an expected
answer, since the correct behavior for Codex specifically depends on
upstream behavior this project doesn't control
([openai/codex#19937](https://github.com/openai/codex/issues/19937),
[openai/codex#15527](https://github.com/openai/codex/issues/15527)).

## Before dispatching

- The agent needs the `agent-journal` plugin installed for its host, and a
  **fresh client/journaling credential** (`AGENT_JOURNAL_TOKEN`, `ag_sk_...`)
  set — never the admin token. Create one against a running server (local or
  deployed) with `agent-journal credentials create --name "smoke-test"`
  using an **admin** token, then hand only the resulting `ag_sk_...` token
  and `AGENT_JOURNAL_URL` to the agent being tested.
- **Codex specifically**: after installing the plugin, run `/hooks`, review
  `agent-journal`'s `SessionStart` hook, and trust it. If this step is
  skipped, the hook never fires and phase 3 below is expected to fail (see
  what that means, below) — that failure mode is itself useful information,
  not a dead end.

## The prompt

Copy-paste this to the agent being tested:

> You're smoke-testing an MCP tool called `agent-journal`. Work through
> these phases in order, and at the end report a structured summary — for
> every step, state which tool you called, its arguments, and its raw
> result (especially any `sessionId` values you observe). Don't summarize
> away the session ids; they're the point of this test.
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
> thread/session (not a resume of this one). In that new session, call
> `journal_append` with `{"data": {"marker": "smoke-test-phase-3"}}`, then
> `journal_get` with no arguments. Report: does this `journal_get` show the
> phase-1/phase-2 entry, or only phase-3? Report both entries' `sessionId`
> values. (Expected: only phase-3, with a different `sessionId` than phase
> 1's. If phase-1 shows up too, in the same session as phase-3, session
> resolution silently fell back to a generated id or a stale hook state
> file rather than picking up the new session — check whether the plugin's
> hook is trusted, if applicable.)
>
> **Phase 4 — subagent attribution.** From your current (phase-3) session,
> dispatch a subagent — in Claude Code, use the Task/Agent tool; in Codex,
> use whatever subagent/nested-execution mechanism you have (a nested
> `codex exec`, a Task tool, etc.). Have the subagent call `journal_append`
> with `{"data": {"marker": "smoke-test-subagent"}}` itself (not you, on its
> behalf) and report the `sessionId` it got back to you. Then, from the
> parent, call `journal_get` again and report whether the subagent's entry
> shares the parent's phase-3 `sessionId` or has a different one.
>
> **Report.** Summarize: every `sessionId` observed across all four phases,
> whether phase 3 correctly started a new session, whether the phase-4
> subagent entry matched or diverged from its parent's session, and
> anything that errored, required manual approval (e.g. a hook-trust
> prompt), or otherwise surprised you.

## Interpreting the results

- **Phases 1–2 failing** is a real regression — file it against this repo.
- **Phase 3 showing the old entry** means the `SessionStart` hook either
  isn't trusted (Codex) or isn't firing, and session resolution fell
  through to `CLAUDE_CODE_SESSION_ID`/`CODEX_THREAD_ID`/a memoized
  generated id — all of which can plausibly stay constant across a `/clear`
  or thread switch depending on the host. Check hook-trust status first.
- **Phase 4's outcome is the actual open question.** Either answer is
  "correct" in the sense that neither is a bug in this project — it
  reflects how the host attributes subagent environments/threads, which
  this project can only detect, not control. Record whichever behavior you
  observe here (in a journal entry, fittingly) so it's not re-litigated
  from scratch next time.
