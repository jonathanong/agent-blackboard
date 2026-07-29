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

The parent must exist under the same client credential; archived parents remain valid. Parent links
are immutable.

## `session_search`

Search undistilled sessions by default:

```json
{
  "agent": "claude-code",
  "version": "1.0.13",
  "data": { "repository": "example/tooling" }
}
```

Every filter is optional. Supported filters are `sessionId`, `parentSessionId`, `agent`, `version`,
`archived`, `data`, and `inactiveForHours`. A `null` parent matches root sessions. The `data` object
is a shallow subset filter: every supplied top-level key must have an exactly equal JSON value in
the session, while additional session data is allowed. `inactiveForHours` must be positive and
matches sessions whose `lastEntryAt` is strictly older than the calculated cutoff; sessions with no
entries do not match.

Omitting `archived`, or setting it to `0`, searches undistilled sessions. Set it to `1` to search archived
sessions. To search both states, call the tool twice. With no filters, the tool lists all active
sessions.

Except when `sessionId` is supplied (see below), the tool returns one page at a time rather than
every match: pass `limit` (max sessions per page, server default 50, hard max 200) and `cursor`
(the opaque `nextCursor` from a previous call) to page through results. Omit `cursor` to fetch the
first page, and keep calling with the returned `nextCursor` until it comes back `null` to see every
match.

Returns:

```json
{ "sessions": [], "nextCursor": null }
```

When `sessionId` is supplied, the tool bypasses pagination entirely: it does a single direct lookup
of that session (not a list scan) and then applies any other supplied filters to it in-process.
`limit` and `cursor` are ignored in this case, `nextCursor` is always `null`, and `sessions` is
either empty (no such session, or it didn't match the other filters) or a single-element array.

## `session_patch`

```json
{ "sessionId": "worker-456", "data": { "branch": "fix/retry" } }
```

The non-empty `data` object is shallow-merged into the unarchived session.

## `session_archive`

```json
{ "sessionId": "worker-456" }
```

The server stores the archive timestamp as `archivedAt`. Archived sessions and entries remain
readable. Archival is a one-time distillation marker: session metadata patches and further
retrospectives/distillation are rejected, but entries remain appendable and new children may refer
to the archived parent.

## `entry_append`

```json
{ "sessionId": "worker-456", "data": { "note": "found the edge case" } }
```

Returns the created `SessionEntry`. The server supplies `createdAt`; the caller supplies everything
else. Appending also updates the session's `lastEntryAt`, including for archived sessions, without
changing `archivedAt`.

## `entry_get`

```json
{ "sessionId": "worker-456", "format": "jsonl" }
```

`format` is optional and may be `json` or `jsonl`. Returns `{ "entries": SessionEntry[] }`. Entries
are append-only: once written, an entry's `data` cannot be changed in place.
