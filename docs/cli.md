# CLI commands

The `agent-blackboard` CLI uses `AGENT_BLACKBOARD_URL` plus either
`AGENT_BLACKBOARD_TOKEN` for sessions/entries or `AGENT_BLACKBOARD_ADMIN_TOKEN` for credentials.
Client and admin credentials are never interchangeable.

## Sessions

```sh
agent-blackboard sessions create root-123 --agent claude-code --version 1.0.13
agent-blackboard sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
agent-blackboard sessions patch worker-456 --data '{"branch":"fix/retry"}'
agent-blackboard sessions list
agent-blackboard sessions list --archived true
agent-blackboard sessions list --inactive-for-hours 8
agent-blackboard sessions list --limit 1
agent-blackboard sessions get worker-456
agent-blackboard sessions archive worker-456
```

`sessions create` requires caller-supplied `--agent` and `--version` and always sends
`parentSessionId`: it is `null` when the parent flag is omitted. Session ids are never inferred or
generated. `sessions patch` shallow-merges a non-empty JSON object into session `data`. Listing
defaults to undistilled sessions; use `--archived true` to list archived sessions. Use
`--inactive-for-hours <hours>` to keep only sessions whose last entry is strictly older than the
cutoff; sessions without entries are excluded. Use `--limit <n>` to fetch a single bounded page
instead of draining every page (the flag omitted otherwise drains the full result set into one flat
JSON array). The store applies filters after the page limit, so a `--limit` page can be shorter than
`n` (even empty) while more matching sessions exist further in the table; use it for a cheap
connectivity probe, not a reliable existence or count check. Archived session metadata cannot be
patched, but entries may still be appended and children
may reference an archived parent.

## Entries

```sh
agent-blackboard append --session-id worker-456 '{"note":"found the edge case"}'
agent-blackboard append --session-id worker-456 < entry.json
agent-blackboard append --session-id worker-456 --file entry.json
agent-blackboard append --session-id worker-456 --file findings.md
agent-blackboard append --session-id worker-456 --file notes.txt
agent-blackboard get --session-id worker-456 --format json
agent-blackboard get --session-id worker-456 --format jsonl
agent-blackboard get --session-id worker-456 --format markdown
```

`append` and `get` require `--session-id`. Entries are append-only: there is no `patch` command for
entries; to record an update, append a new entry. Reads stream bytes to stdout without buffering the
full response.

For `append --file`, `.json` files must contain a JSON object. `.md` and `.markdown` files are sent
as `{ "markdown": "..." }`; `.txt` files are sent as `{ "text": "..." }`.

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
