# MCP tools

Start the stdio server with `agent-blackboard mcp`. It reads `AGENT_BLACKBOARD_URL` and
`AGENT_BLACKBOARD_TOKEN`. Credential management is intentionally CLI/admin-only.

All ids are explicit. The MCP server never infers a host session id and never generates one.

## `session_create`

Creates session metadata before any entries are written.

```json
{ "sessionId": "root-123", "parentSessionId": null }
```

For a subagent, pass its direct parent's id:

```json
{ "sessionId": "worker-456", "parentSessionId": "root-123" }
```

The parent must exist under the same client credential and must be active. Parent links are
immutable.

## `session_archive`

```json
{ "sessionId": "worker-456" }
```

Archival applies to the session. Archived sessions reject entry reads, appends, patches, and new
children.

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

`format` is optional and may be `json` or `jsonl`. Returns `{ "entries": SessionEntry[] }`.

## `entry_patch`

```json
{
  "sessionId": "worker-456",
  "createdAt": "2026-07-19T20:00:00.000Z",
  "data": { "pr": 7777 }
}
```

The composite key `(sessionId, createdAt)` selects exactly one entry. `data` is shallow-merged.
