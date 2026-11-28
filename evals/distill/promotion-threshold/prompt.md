---
model: claude-sonnet-5-5
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
tags: [distill, priority-medium]
append_system_prompt: |
  You have no shell and no network access. Do not run shell commands, fetch
  anything over the network, or read repository files other than a reference
  file linked from a skill you loaded. Do not ask for the repository to be provided.

  The agent-blackboard MCP server is configured for this session but is not
  connected right now, so you cannot call its tools. These are its tools:

  - session_create: Creates a root or subagent session before entries are appended. Args: sessionId, parentSessionId (null for a root session; the direct parent session id for a subagent), agent, version, data.
  - session_ensure: Idempotently creates a session: if it already exists, verifies parentSessionId/agent/version match instead of erroring.
  - session_search: Searches undistilled or archived sessions using exact metadata, data, dataArrayContains, and inactiveForHours filters. Pages via limit/cursor.
  - session_patch: Shallow-merges arbitrary data into one unarchived session. Args: sessionId, data.
  - session_archive: Marks a session as distilled. Metadata becomes immutable, but entries remain appendable. Args: sessionId.
  - entry_append: Appends an entry to an existing session, including an archived one. Args: sessionId, data, optional schemaId, schemaVersion, sourceEventId.
  - entry_get: Reads entries from one existing session.
  - snapshot_export: Streams an immutable non-archived snapshot into a local private JSONL file and returns its path, counts, checksum, manifest, and (when path is omitted) cleanupToken. Args: optional path, inactiveForHours, data, dataArrayContains, agent, version, parentSessionId.
  - snapshot_partition: Splits a generated temporary snapshot JSONL file into bounded session-preserving read-only partitions using the cleanupToken from snapshot_export. Args: path, cleanupToken, optional maxSessions, maxBytes, checksum, counts.
  - snapshot_cleanup: Removes a generated temporary snapshot file and/or partition directory using the cleanupToken from snapshot_export or snapshot_partition. Pass path, directory, or both: the token alone removes nothing and is rejected. Args: cleanupToken, path, directory.
  - outbox_status, outbox_flush, outbox_prune_rejected: inspect, deliver, or drop entry writes queued locally while the server was unreachable.
  - schema_list, schema_get, schema_pull, schema_validate: inspect and validate against registered JSON Schemas.

  You MAY use any skill available to you. If a skill is relevant to this request,
  load it before you plan. If that skill points at a reference file, read it
  before you plan.

  State the plan you would execute, as concrete numbered steps that someone could
  follow without you. Where a step calls a tool, give the tool name and its exact
  arguments as JSON. Where you decide NOT to take an action, say so explicitly and
  say why. The plan is the deliverable: do not ask for the tools to be connected
  or for output to be pasted back.
---

I need a short list of things worth actually fixing from last week's agent journals — don't give
me every little note. The export is below.

```json
{
  "path": "/tmp/agent-blackboard-snapshot-d4410a.jsonl",
  "counts": { "sessions": 4, "entries": 5, "bytes": 2630 },
  "checksum": { "algorithm": "sha256", "value": "7a1f9c" },
  "manifest": { "inactiveForHours": 24 },
  "cleanupToken": "ct_c3a8"
}
```

/tmp/agent-blackboard-snapshot-d4410a.jsonl:

```jsonl
{"type":"session","sessionId":"cc-p1","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-21T08:00:00.000Z","lastEntryAt":"2026-11-21T08:30:00.000Z"}
{"type":"entry","sessionId":"cc-p1","createdAt":"2026-11-21T08:30:00.000Z","data":{"finding":"pnpm install failed until I deleted node_modules; lockfile was from another pnpm major"}}
{"type":"session","sessionId":"cc-p2","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-22T08:00:00.000Z","lastEntryAt":"2026-11-22T09:10:00.000Z"}
{"type":"entry","sessionId":"cc-p2","createdAt":"2026-11-22T08:50:00.000Z","data":{"finding":"wrong pnpm major again: had to run corepack enable before install worked"}}
{"type":"entry","sessionId":"cc-p2","createdAt":"2026-11-22T09:10:00.000Z","data":{"finding":"the deploy script printed the full AWS secret access key into the CI log"}}
{"type":"session","sessionId":"cc-p3","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-23T08:00:00.000Z","lastEntryAt":"2026-11-23T08:20:00.000Z"}
{"type":"entry","sessionId":"cc-p3","createdAt":"2026-11-23T08:20:00.000Z","data":{"finding":"renamed a variable for clarity in the CLI parser"}}
{"type":"session","sessionId":"cc-p4","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-24T08:00:00.000Z","lastEntryAt":"2026-11-24T08:05:00.000Z"}
{"type":"entry","sessionId":"cc-p4","createdAt":"2026-11-24T08:05:00.000Z","data":{"finding":"one vitest file took 40s once; didn't reproduce"}}
```
