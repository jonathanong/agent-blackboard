# CLI commands

The `agent-blackboard` CLI uses `AGENT_BLACKBOARD_URL` plus either
`AGENT_BLACKBOARD_TOKEN` for sessions/entries or `AGENT_BLACKBOARD_ADMIN_TOKEN` for credentials.
Client and admin credentials are never interchangeable.

## Sessions

```sh
agent-blackboard sessions create root-123
agent-blackboard sessions create worker-456 --parent-session-id root-123
agent-blackboard sessions list
agent-blackboard sessions get worker-456
agent-blackboard sessions archive worker-456
```

`sessions create` always sends `parentSessionId`: it is `null` when the flag is omitted. Session ids
are never inferred or generated.

## Entries

```sh
agent-blackboard append --session-id worker-456 '{"note":"found the edge case"}'
agent-blackboard append --session-id worker-456 < entry.json
agent-blackboard get --session-id worker-456 --format json
agent-blackboard get --session-id worker-456 --format jsonl
agent-blackboard get --session-id worker-456 --format markdown
agent-blackboard patch --session-id worker-456 \
  --created-at 2026-07-19T20:00:00.000Z --data '{"pr":7777}'
```

`append`, `get`, and `patch` require `--session-id`. `patch` identifies one entry with
`--session-id` plus `--created-at` and shallow-merges the `--data` object. Reads stream bytes to
stdout without buffering the full response.

## Credentials

```sh
agent-blackboard credentials create --name "my laptop"
agent-blackboard credentials list
agent-blackboard credentials delete --name "my laptop"
agent-blackboard credentials delete --id <credential-id>
```

Creating a credential prints its raw token once. Names are not unique; deletion by name removes all
matches. Credential commands are never exposed over MCP.

## MCP server

```sh
agent-blackboard mcp
```

See [MCP tools](mcp.md).
