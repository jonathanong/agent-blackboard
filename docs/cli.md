# CLI commands

The `atel` command (published in `@jongleberry/atel`).
Output is JSON by default; exit code is `0` on success, `1` on any error,
with a one-line `Error: ...` message on stderr — never a raw stack trace.

```sh
npx @jongleberry/atel --help
```

## Configuration

| Env var                  | Used by                  | Meaning                                            |
| ------------------------ | ------------------------ | -------------------------------------------------- |
| `ATEL_URL`               | all commands             | Base URL of the atel server.                       |
| `ATEL_TOKEN`             | `append`, `get`, `patch` | Telemetry credential (`atl_sk_<credId>_<secret>`). |
| `ATEL_ADMIN_TOKEN`       | `credentials`            | Admin credential (`atl_admin_<name>_<secret>`).    |
| `CLAUDE_CODE_SESSION_ID` | session resolution       | Fallback session id (Claude Code).                 |
| `CODEX_THREAD_ID`        | session resolution       | Fallback session id (Codex).                       |

Telemetry and admin tokens are never interchangeable — see
[`architecture.md#auth-model`](architecture.md#auth-model).

## `atel append <json>`

Append one entry to the telemetry stream for the current (or given) session.

```sh
atel append '{"note": "found a flaky retry in the payments worker"}'
atel append   # reads JSON from stdin if no argument is given
```

## `atel get [flags]`

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
atel get                              # this session, json
atel get --format jsonl
atel get --format markdown
atel get --all-sessions --agent codex
atel get --archived false
```

## `atel patch <id> [flags]`

Patch one entry, or a batch from a file.

| Flag                | Values         | Meaning                                                                             |
| ------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `--archived <bool>` | `true`/`false` | Archive/unarchive the entry.                                                        |
| `--data <json>`     | JSON object    | Shallow-merged into the entry's existing `data` — not a replace.                    |
| `--file <path>`     | file path      | Batch mode: a JSON array of `{ id, archived?, data? }`, ignores `<id>`/other flags. |

```sh
atel patch <id> --archived true
atel patch <id> --data '{"pr": 7777}'
atel patch --file patches.json
```

## `atel credentials <subcommand>`

Admin-only (`ATEL_ADMIN_TOKEN`). Never exposed over MCP.

| Subcommand | Flags                                         | Meaning                                                                                          |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `create`   | `--name <name>` (required)                    | Creates a credential, prints `{ id, name, token, createdAt }` — the raw token is shown **once**. |
| `list`     | —                                             | Lists `{ id, name, createdAt }[]` — never includes tokens.                                       |
| `delete`   | `--id <id>` or `--name <name>` (one required) | Deletes the credential(s); by name, deletes **all** matches (names aren't unique).               |

```sh
atel credentials create --name "my laptop"
atel credentials list
atel credentials delete --name "my laptop"
```

## `atel mcp`

Starts the MCP stdio server. See [`mcp.md`](mcp.md) for the tools it
exposes.

```sh
atel mcp
```
