# MCP commands

`atel` ships a stdio MCP server exposing exactly three tools.
Credential management is deliberately **not** here — creating, listing, and
deleting credentials is CLI/admin-only (see [`cli.md`](cli.md)), never
exposed to a model over MCP.

## Starting the server

```sh
atel mcp
```

Reads `ATEL_URL` and `ATEL_TOKEN` from the environment
(the same telemetry credential the CLI uses — never an admin token).

### Registering it with a plugin host

`plugins/atel/.mcp.json` registers this for both Claude Code and
Codex plugin installs:

```json
{
  "mcpServers": {
    "atel": {
      "command": "npx",
      "args": ["-y", "atel", "mcp"],
      "env": {
        "ATEL_URL": "${ATEL_URL}",
        "ATEL_TOKEN": "${ATEL_TOKEN}"
      }
    }
  }
}
```

Installing the plugin (see the repo README) wires this up automatically —
you only need `ATEL_URL`/`ATEL_TOKEN` set in your
environment.

## Tools

### `telemetry_append`

Append an entry to the telemetry stream for the current (or given) session.
`data` is unstructured JSON — attach whatever's useful: notes, branch names,
PR numbers, decisions made. This is a stream-of-consciousness log, not a
knowledge base.

| Arg         | Type   | Required | Notes                                                                                          |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `data`      | object | yes      | Arbitrary JSON payload for this entry.                                                         |
| `sessionId` | string | no       | Defaults to the current session (see [Session resolution](architecture.md#session-lifecycle)). |
| `agent`     | string | no       | Defaults to `'claude-code'`.                                                                   |

Returns the created entry.

### `telemetry_get`

Reads back telemetry entries for the current (or given) session, optionally
filtered.

| Arg         | Type                | Required | Notes                                                                                  |
| ----------- | ------------------- | -------- | -------------------------------------------------------------------------------------- |
| `sessionId` | string              | no       | Defaults to the current session — "read back what I just recorded" needs no arguments. |
| `agent`     | string              | no       | Filter by agent identifier.                                                            |
| `archived`  | boolean             | no       | Filter by archived status.                                                             |
| `format`    | `'json' \| 'jsonl'` | no       | Internal wire format. Defaults to `jsonl`.                                             |

Returns `{ entries: TelemetryEntry[] }`. Reads reuse the same
genuinely-incremental client internally, then collect into the tool
response — MCP tool results aren't naturally streaming to the model.

### `telemetry_patch`

Batch-patches entries by id: archive them and/or shallow-merge new data
into their existing `data` blob (e.g. attach a PR number once it exists).

| Arg       | Type                                                       | Required | Notes                           |
| --------- | ---------------------------------------------------------- | -------- | ------------------------------- |
| `patches` | `Array<{ id: string, archived?: boolean, data?: object }>` | yes      | `data` is merged, not replaced. |

Returns `{ patched: TelemetryEntry[] }`.

## Example tool calls

```json
{
  "name": "telemetry_append",
  "arguments": { "data": { "note": "the retry logic in worker.mts silently swallows 429s" } }
}
```

```json
{ "name": "telemetry_get", "arguments": { "archived": false } }
```

```json
{
  "name": "telemetry_patch",
  "arguments": { "patches": [{ "id": "abc123#01H...", "archived": true, "data": { "pr": 7777 } }] }
}
```

See [`loop-engineering.md`](loop-engineering.md) for how a skill typically
sequences these calls to build a self-improvement loop.
