---
name: atel
description: Record and retrieve entries in atel — an append-only, session-scoped stream of consciousness for autonomous agent work. Use when recording telemetry about progress, decisions, or findings while working unmonitored, or when pulling back a past session's telemetry to distill learnings.
when_to_use: Use whenever the user or a project-specific skill asks you to record telemetry about your work, or when you need to review your own past telemetry entries (this session's or a prior one) before continuing or self-improving.
---

# atel

`atel` (Agent Telemetry) is a telemetry log for autonomous agents — an append-only,
session-scoped stream of consciousness, not a knowledge base. This skill explains **how** to use
it. It does **not** tell you **what** to record — that's the job of a separate, project-specific
skill (mirroring how the `~/filaments` retrospective skills layer "what" on top of a generic
"how"). If this project has no such skill, ask the user what they want recorded, or use your own
judgment.

## How it works

- **Session scoping is automatic.** Entries are grouped under the current session's id. Starting a
  new session (for example, running `/clear`) automatically starts a fresh telemetry stream — you
  never manage session ids yourself.
- **`data` is unstructured.** Every entry carries a free-form `data` object. Attach whatever is
  useful — a note, a branch name, a PR number, a decision and its rationale. There is no schema.
- **It's append-only, with patching for enrichment.** Add entries as you go; `patch` lets you merge
  more `data` into an existing entry later (e.g. tag earlier entries with a PR number once the PR
  exists) or mark it `archived` once it's been distilled.

## Using it via MCP

If the `atel` MCP server is connected, use its tools directly:

- `telemetry_append` — append one entry with a `data` payload.
- `telemetry_get` — stream back entries for the current (or a given) session, optionally filtered
  by `archived`.
- `telemetry_patch` — batch-update entries by id: merge new `data` and/or set `archived`.

## Using it via the CLI

Without MCP, or from a shell/script, use the `atel` CLI:

```bash
atel append '{"note": "started investigating the flaky test"}'
atel get --all-sessions --format markdown   # --all-sessions: safe even if this shell has no session id resolved
atel patch <id> --data '{"pr": 1234}'
```

Output defaults to JSON; pass `--format jsonl` or `--format markdown` for streaming or
human-readable reads.

## What this skill does not do

This skill only covers **how** to append, get, and patch telemetry entries. It does not prescribe
**what** to record — write, or look for, a project-specific skill that layers that guidance on top
of this one.
