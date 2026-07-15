# MCP commands

`agent-journal` ships a stdio MCP server exposing exactly three tools.
Credential management is deliberately **not** here — creating, listing, and
deleting credentials is CLI/admin-only (see [`cli.md`](cli.md)), never
exposed to a model over MCP.

## Starting the server

```sh
agent-journal mcp
```

Reads `AGENT_JOURNAL_URL` and `AGENT_JOURNAL_TOKEN` from the environment
(the same journaling credential the CLI uses — never an admin token).

### Registering it with a plugin host

`plugins/agent-journal/.mcp.json` registers this for both Claude Code and
Codex plugin installs:

```json
{
  "mcpServers": {
    "agent-journal": {
      "command": "npx",
      "args": ["-y", "@jongleberry/agent-journal", "mcp"],
      "env": {
        "AGENT_JOURNAL_URL": "${AGENT_JOURNAL_URL}",
        "AGENT_JOURNAL_TOKEN": "${AGENT_JOURNAL_TOKEN}"
      }
    }
  }
}
```

Installing the plugin (see the repo README) wires this up automatically —
you only need `AGENT_JOURNAL_URL`/`AGENT_JOURNAL_TOKEN` set in your
environment.

## Tools

### `journal_append`

Append an entry to the journal for the current (or given) session. `data`
is unstructured JSON — attach whatever's useful: notes, branch names, PR
numbers, decisions made. This is a stream-of-consciousness log, not a
knowledge base.

| Arg         | Type   | Required | Notes                                                                                          |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `data`      | object | yes      | Arbitrary JSON payload for this entry.                                                         |
| `sessionId` | string | no       | Defaults to the current session (see [Session resolution](architecture.md#session-lifecycle)). |
| `agent`     | string | no       | Defaults to `'claude-code'`.                                                                   |

Returns the created entry.

### `journal_get`

Reads back journal entries for the current (or given) session, optionally
filtered.

| Arg         | Type                | Required | Notes                                                                                   |
| ----------- | ------------------- | -------- | --------------------------------------------------------------------------------------- |
| `sessionId` | string              | no       | Defaults to the current session — "read back what I just journaled" needs no arguments. |
| `agent`     | string              | no       | Filter by agent identifier.                                                             |
| `archived`  | boolean             | no       | Filter by archived status.                                                              |
| `format`    | `'json' \| 'jsonl'` | no       | Internal wire format. Defaults to `jsonl`.                                              |

Returns `{ entries: JournalEntry[] }`. Reads reuse the same
genuinely-incremental client internally, then collect into the tool
response — MCP tool results aren't naturally streaming to the model.

### `journal_patch`

Batch-patches entries by id: archive them and/or shallow-merge new data
into their existing `data` blob (e.g. attach a PR number once it exists).

| Arg       | Type                                                       | Required | Notes                           |
| --------- | ---------------------------------------------------------- | -------- | ------------------------------- |
| `patches` | `Array<{ id: string, archived?: boolean, data?: object }>` | yes      | `data` is merged, not replaced. |

Returns `{ patched: JournalEntry[] }`.

## Example tool calls

```json
{
  "name": "journal_append",
  "arguments": { "data": { "note": "the retry logic in worker.mts silently swallows 429s" } }
}
```

```json
{ "name": "journal_get", "arguments": { "archived": false } }
```

```json
{
  "name": "journal_patch",
  "arguments": { "patches": [{ "id": "abc123#01H...", "archived": true, "data": { "pr": 7777 } }] }
}
```

See [`loop-engineering.md`](loop-engineering.md) for how a skill typically
sequences these calls to build a self-improvement loop.
