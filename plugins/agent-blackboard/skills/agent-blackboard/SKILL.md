---
name: agent-blackboard
description: Create sessions and record entries in agent-blackboard, an append-only stream for autonomous agent work. Use when recording progress, decisions, or findings, or reviewing a known session later.
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
- **Entries are strictly append-only.** An entry's `data` cannot be changed after it is written; to
  enrich or correct an earlier observation, append a new entry rather than editing the original.
  Archival applies to the whole session.

## Using it via MCP

If the `agent-blackboard` MCP server is connected, use its tools directly:

- `session_create` — create a root or subagent session with explicit `sessionId` and
  `parentSessionId` (use `null` for a root), plus `agent` and `version`.
- `session_search` — find undistilled or archived sessions with exact metadata, data, and optional
  `inactiveForHours` filters.
- `session_patch` — shallow-merge `data` into an unarchived session.
- `session_archive` — mark a session as distilled; archival is one-time and metadata becomes
  immutable.
- `entry_append` — append `data` to any existing session, including an archived one.
- `entry_get` — read entries from one explicit session.

## Using it via the CLI

Without MCP, or from a shell/script, run the published CLI through `npx`. This does not require a
local clone of the agent-blackboard repository:

```bash
npx -y agent-blackboard@0.1.1 sessions create root-123 --agent claude-code --version 1.0.13
npx -y agent-blackboard@0.1.1 sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
npx -y agent-blackboard@0.1.1 sessions patch worker-456 --data '{"branch":"fix/retry"}'
npx -y agent-blackboard@0.1.1 append --session-id worker-456 '{"note":"found the failing edge case"}'
npx -y agent-blackboard@0.1.1 get --session-id worker-456 --format markdown
```

Output defaults to JSON; pass `--format jsonl` or `--format markdown` for streaming or
human-readable reads.

## What this skill does not do

This skill only covers **how** to create sessions and append and get entries. It does not prescribe
**what** to record — write, or look for, a project-specific skill that layers that guidance on top
of this one.
