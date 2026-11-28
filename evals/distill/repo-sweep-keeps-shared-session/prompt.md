---
model: claude-sonnet-5-5
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
tags: [distill, priority-high]
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

Time to clean up the blackboard for jongleberry/pr-shepherd: pull out follow-ups from its idle
sessions and archive whatever you've distilled. The export's done:

```json
{
  "path": "/tmp/agent-blackboard-snapshot-b81f02.jsonl",
  "counts": { "sessions": 2, "entries": 4, "bytes": 1960 },
  "checksum": { "algorithm": "sha256", "value": "c07d5e" },
  "manifest": {
    "inactiveForHours": 24,
    "dataArrayContains": { "repositories": "jongleberry/pr-shepherd" }
  },
  "cleanupToken": "ct_2f60"
}
```

/tmp/agent-blackboard-snapshot-b81f02.jsonl:

```jsonl
{"type":"session","sessionId":"cc-s1","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/pr-shepherd"]},"createdAt":"2026-11-26T08:00:00.000Z","lastEntryAt":"2026-11-26T08:45:00.000Z"}
{"type":"entry","sessionId":"cc-s1","createdAt":"2026-11-26T08:45:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"finding":"merge queue ejection was reported as a CI failure"}}
{"type":"session","sessionId":"cc-s2","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/agent-blackboard","jongleberry/pr-shepherd"]},"createdAt":"2026-11-26T12:00:00.000Z","lastEntryAt":"2026-11-26T13:20:00.000Z"}
{"type":"entry","sessionId":"cc-s2","createdAt":"2026-11-26T12:30:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"finding":"merge queue ejection showed up as a red CI check again"}}
{"type":"entry","sessionId":"cc-s2","createdAt":"2026-11-26T13:00:00.000Z","data":{"repositories":["jongleberry/agent-blackboard"],"finding":"session_patch race dropped a repository from the union"}}
{"type":"entry","sessionId":"cc-s2","createdAt":"2026-11-26T13:20:00.000Z","data":{"repositories":["jongleberry/agent-blackboard"],"finding":"outbox flush retried a 400 forever"}}
```

Both sessions still show the same lastEntryAt as the export when I re-read them just now.
