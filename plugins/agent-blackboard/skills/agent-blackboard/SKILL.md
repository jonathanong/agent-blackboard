---
name: agent-blackboard
description: Create sessions and record entries in agent-blackboard, an append-only stream for autonomous agent work. Use when recording progress, decisions, or findings, or reviewing a known session later.
when_to_use: Use whenever the user or project instructions ask you to record or review agent-blackboard entries.
---

# agent-blackboard

`agent-blackboard` is an append-only, session-scoped entry stream, not a knowledge base. This
skill explains how to use it; project instructions decide what is worth recording.

## How it works

- **Session ids are explicit.** The caller must choose an id and create the session before writing.
  The service never infers or generates one.
- **Subagents get their own sessions.** Create each subagent session with its direct parent's id in
  `parentSessionId`. Root sessions use `parentSessionId: null`.
- **Agent identity is explicit.** Every session creation includes the actual agent name and version.
- **Sessions can carry data.** Session patches shallow-merge a free-form `data` object.
- **`data` is unstructured.** Every entry carries a free-form `data` object. Attach whatever is
  useful — a note, a branch name, a PR number, a decision and its rationale. There is no schema.
- **Entries are append-only, with patching for enrichment.** An entry is identified by
  `(sessionId, createdAt)`. Patches shallow-merge `data`; archival applies to the whole session.

## Using it via MCP

If the `agent-blackboard` MCP server is connected, use its tools directly:

- `session_create` — create a root or subagent session with explicit `sessionId` and
  `parentSessionId` (use `null` for a root), plus `agent` and `version`.
- `session_search` — find active or archived sessions with exact metadata and data filters.
- `session_patch` — shallow-merge `data` into an active session.
- `session_archive` — set `archivedAt`; archived data remains readable but immutable.
- `entry_append` — append `data` to an existing active session.
- `entry_get` — read entries from one explicit session.
- `entry_patch` — shallow-merge `data` into one entry identified by `sessionId` and `createdAt`.

## Using it via the CLI

Without MCP, or from a shell/script, use the `agent-blackboard` CLI:

```bash
agent-blackboard sessions create root-123 --agent claude-code --version 1.0.13
agent-blackboard sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
agent-blackboard sessions patch worker-456 --data '{"branch":"fix/retry"}'
agent-blackboard append --session-id worker-456 '{"note":"found the failing edge case"}'
agent-blackboard get --session-id worker-456 --format markdown
agent-blackboard patch --session-id worker-456 --created-at <timestamp> --data '{"pr":1234}'
```

Output defaults to JSON; pass `--format jsonl` or `--format markdown` for streaming or
human-readable reads.

## What this skill does not do

This skill only covers **how** to create sessions and append, get, and patch entries. It does not prescribe
**what** to record — write, or look for, a project-specific skill that layers that guidance on top
of this one.
