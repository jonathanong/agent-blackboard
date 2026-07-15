# CLI commands

The `agent-journal` command (published in `@jongleberry/agent-journal`).
Output is JSON by default; exit code is `0` on success, `1` on any error,
with a one-line `Error: ...` message on stderr — never a raw stack trace.

```sh
npx @jongleberry/agent-journal --help
```

## Configuration

| Env var                     | Used by                  | Meaning                                            |
| --------------------------- | ------------------------ | -------------------------------------------------- |
| `AGENT_JOURNAL_URL`         | all commands             | Base URL of the agent-journal server.              |
| `AGENT_JOURNAL_TOKEN`       | `append`, `get`, `patch` | Journaling credential (`ag_sk_<credId>_<secret>`). |
| `AGENT_JOURNAL_ADMIN_TOKEN` | `credentials`            | Admin credential (`ag_admin_<name>_<secret>`).     |
| `CLAUDE_CODE_SESSION_ID`    | session resolution       | Fallback session id (Claude Code).                 |
| `CODEX_THREAD_ID`           | session resolution       | Fallback session id (Codex).                       |

Journaling and admin tokens are never interchangeable — see
[`architecture.md#auth-model`](architecture.md#auth-model).

## `agent-journal append <json>`

Append one entry to the journal for the current (or given) session.

```sh
agent-journal append '{"note": "found a flaky retry in the payments worker"}'
agent-journal append   # reads JSON from stdin if no argument is given
```

## `agent-journal get [flags]`

Streams entries to stdout as they arrive — never buffers the full response,
regardless of format.

| Flag                | Values                    | Default                  | Meaning                                                                |
| ------------------- | ------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `--session-id <id>` | string                    | resolved current session | Which session to read.                                                 |
| `--agent <name>`    | string                    | (none)                   | Filter by agent identifier.                                            |
| `--archived <bool>` | `true`/`false`            | (none)                   | Filter by archived status.                                             |
| `--format <fmt>`    | `json`/`jsonl`/`markdown` | `json`                   | Output format.                                                         |
| `--all-sessions`    | flag                      | off                      | Read across every session for this credential, instead of one session. |

```sh
agent-journal get                              # this session, json
agent-journal get --format jsonl
agent-journal get --format markdown
agent-journal get --all-sessions --agent codex
agent-journal get --archived false
```

## `agent-journal patch <id> [flags]`

Patch one entry, or a batch from a file.

| Flag                | Values         | Meaning                                                                             |
| ------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `--archived <bool>` | `true`/`false` | Archive/unarchive the entry.                                                        |
| `--data <json>`     | JSON object    | Shallow-merged into the entry's existing `data` — not a replace.                    |
| `--file <path>`     | file path      | Batch mode: a JSON array of `{ id, archived?, data? }`, ignores `<id>`/other flags. |

```sh
agent-journal patch <id> --archived true
agent-journal patch <id> --data '{"pr": 7777}'
agent-journal patch --file patches.json
```

## `agent-journal credentials <subcommand>`

Admin-only (`AGENT_JOURNAL_ADMIN_TOKEN`). Never exposed over MCP.

| Subcommand | Flags                                         | Meaning                                                                                          |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `create`   | `--name <name>` (required)                    | Creates a credential, prints `{ id, name, token, createdAt }` — the raw token is shown **once**. |
| `list`     | —                                             | Lists `{ id, name, createdAt }[]` — never includes tokens.                                       |
| `delete`   | `--id <id>` or `--name <name>` (one required) | Deletes the credential(s); by name, deletes **all** matches (names aren't unique).               |

```sh
agent-journal credentials create --name "my laptop"
agent-journal credentials list
agent-journal credentials delete --name "my laptop"
```

## `agent-journal mcp`

Starts the MCP stdio server. See [`mcp.md`](mcp.md) for the tools it
exposes.

```sh
agent-journal mcp
```
