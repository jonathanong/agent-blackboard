# MCP tools

Start the stdio server with `agent-blackboard mcp`. It reads `AGENT_BLACKBOARD_URL` and
`AGENT_BLACKBOARD_TOKEN`. Credential management is intentionally CLI/admin-only.

All ids are explicit. The MCP server never infers a host session id and never generates one.

## `session_create`

Creates session metadata before any entries are written.

```json
{
  "sessionId": "root-123",
  "parentSessionId": null,
  "agent": "claude-code",
  "version": "1.0.13"
}
```

For a subagent, pass its direct parent's id:

```json
{
  "sessionId": "worker-456",
  "parentSessionId": "root-123",
  "agent": "claude-code",
  "version": "1.0.13"
}
```

The parent must exist under the same client credential and must be active. Parent links are
immutable.

## `session_search`

Search active sessions by default:

```json
{
  "agent": "claude-code",
  "version": "1.0.13",
  "data": { "repository": "example/tooling" }
}
```

Every filter is optional and exact. Supported filters are `sessionId`, `parentSessionId`, `agent`,
`version`, `archived`, and `data`. A `null` parent matches root sessions. The `data` object is a
shallow subset filter: every supplied top-level key must have an exactly equal JSON value in the
session, while additional session data is allowed.

Omitting `archived`, or setting it to `0`, searches active sessions. Set it to `1` to search archived
sessions. To search both states, call the tool twice. With no filters, the tool lists all active
sessions.

Returns:

```json
{ "sessions": [] }
```

## `session_patch`

```json
{ "sessionId": "worker-456", "data": { "branch": "fix/retry" } }
```

The non-empty `data` object is shallow-merged into the active session.

## `session_archive`

```json
{ "sessionId": "worker-456" }
```

The server stores the archive timestamp as `archivedAt`. Archived sessions and entries remain
readable, but session/entry writes and new children are rejected.

## `entry_append`

```json
{ "sessionId": "worker-456", "data": { "note": "found the edge case" } }
```

Returns the created `SessionEntry`. The server supplies `createdAt`; the caller supplies everything
else.

## `entry_get`

```json
{ "sessionId": "worker-456", "format": "jsonl" }
```

`format` is optional and may be `json` or `jsonl`. Returns `{ "entries": SessionEntry[] }`. Entries
are append-only: once written, an entry's `data` cannot be changed in place.
