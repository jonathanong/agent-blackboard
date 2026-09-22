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
- **Repository context has a standard convention.** When recording repository work, use
  `repositories` as a sorted, deduplicated array of lowercase GitHub `owner/name` strings. The
  session's `data.repositories` is the cumulative union; an entry's `data.repositories` contains
  only repositories relevant to that entry. Untagged historical data is unclassified, so do not
  infer repositories from its text or path.
- **Entries are strictly append-only.** An entry's `data` cannot be changed after it is written; to
  enrich or correct an earlier observation, append a new entry rather than editing the original.
  Archival applies to the whole session.

## Using it via MCP

If the `agent-blackboard` MCP server is connected, use its tools directly:

- `session_create` — create a root or subagent session with explicit `sessionId` and
  `parentSessionId` (use `null` for a root), plus `agent` and `version`.
- `session_search` — find undistilled or archived sessions with exact metadata, data, and optional
  `inactiveForHours` filters. When supported, `dataArrayContains` matches exact array membership,
  including repository tags.
- `session_patch` — shallow-merge `data` into an unarchived session.
- `session_archive` — mark a session as distilled; archival is one-time and metadata becomes
  immutable.
- `entry_append` — append `data` to any existing session, including an archived one.
- `entry_get` — read entries from one explicit session.
- `snapshot_export` — stream all selected active sessions and entries to a private read-only JSONL
  file, returning only its path, counts, checksum, and manifest.

## Using it via the CLI

Without MCP, or from a shell/script, run the published CLI through `npx`. This does not require a
local clone of the agent-blackboard repository:

```bash
npx -y agent-blackboard@0.5.0 sessions create root-123 --agent claude-code --version 1.0.13
npx -y agent-blackboard@0.5.0 sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
npx -y agent-blackboard@0.5.0 sessions patch worker-456 --data '{"branch":"fix/retry"}'
npx -y agent-blackboard@0.5.0 sessions patch worker-456 --data '{"repositories":["owner/name"]}'
npx -y agent-blackboard@0.5.0 append --session-id worker-456 '{"repositories":["owner/name"],"note":"found the failing edge case"}'
npx -y agent-blackboard@0.5.0 get --session-id worker-456 --format markdown
npx -y agent-blackboard@0.5.0 snapshot export --root-only --inactive-for-hours 8
npx -y agent-blackboard@0.5.0 snapshot partition --path /tmp/agent-blackboard-snapshot-<uuid>.jsonl \
  --cleanup-token <cleanup-token>
npx -y agent-blackboard@0.5.0 snapshot cleanup --path /tmp/agent-blackboard-snapshot-<uuid>.jsonl \
  --directory /tmp/agent-blackboard-partitions-<suffix> --cleanup-token <cleanup-token>
```

Output defaults to JSON; pass `--format jsonl` or `--format markdown` for streaming or
human-readable reads.

Before appending a repository-tagged entry, merge its tags into the session's cumulative list,
normalize the list, and wait for `sessions patch` to succeed. If it fails, do not append; start a
new session after archival because archived metadata cannot be patched. The entry tag remains the
authority for repository-scoped evidence. A session can span repositories, so a repository-scoped
review includes only entries whose tag array contains the selected repository and does not archive
the shared session until all of its tagged repositories have been reviewed.

`snapshot partition` accepts only a generated temporary export path plus the cleanup token printed by
export, preserves whole sessions and their entry order, and creates private read-only partition
files. It defaults to 25 sessions or 1 MiB per partition. `snapshot cleanup` requires the same token
and accepts either generated artifact or both; use it when the bounded evidence is no longer needed.
Explicit `snapshot export --path` destinations remain available for caller-controlled export, but
cannot be partitioned or cleaned up by these commands.

Generated names, private modes, capabilities, and identity checks reject substitutions visible at
operation boundaries. Do not place snapshot artifacts where a malicious concurrent process with the
same operating-system user identity can swap pathnames between those checks; that race is outside
the pure-Node package boundary.

## What this skill does not do

This skill only covers **how** to create sessions and append and get entries. It does not prescribe
**what** to record — write, or look for, a project-specific skill that layers that guidance on top
of this one.
