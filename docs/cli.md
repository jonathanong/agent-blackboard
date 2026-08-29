# CLI commands

The `agent-blackboard` CLI uses `AGENT_BLACKBOARD_URL` plus either
`AGENT_BLACKBOARD_TOKEN` for sessions/entries or `AGENT_BLACKBOARD_ADMIN_TOKEN` for credentials.
Client and admin credentials are never interchangeable.

## Sessions

```sh
agent-blackboard sessions create root-123 --agent claude-code --version 1.0.13
agent-blackboard sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
agent-blackboard sessions ensure root-123 --agent claude-code --version 1.0.13
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
generated. `sessions ensure` takes the same flags as `sessions create` but is idempotent: if the
session already exists, it verifies `parentSessionId`/`agent`/`version` match instead of erroring,
returning `{"status":"created"|"exists","session":...}` either way — a mismatch still throws.
`sessions patch` shallow-merges a non-empty JSON object into session `data`. Listing
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

## Snapshots

```sh
agent-blackboard snapshot export
agent-blackboard snapshot export --path /absolute/path/evidence.jsonl
agent-blackboard snapshot export --root-only --inactive-for-hours 8
agent-blackboard snapshot export --agent codex --version 1.0.0 \
  --data '{"repository":"example/tooling"}'
agent-blackboard snapshot partition --path /tmp/agent-blackboard-snapshot-<uuid>.jsonl
agent-blackboard snapshot cleanup --path /tmp/agent-blackboard-snapshot-<uuid>.jsonl \
  --directory /tmp/agent-blackboard-partitions-<suffix>
```

The command streams every matching unarchived session and entry into a newly created private file.
If `--path` is omitted, it creates a unique file under the system temporary directory. A supplied
path must be absolute and must not already exist. On success the file is changed to read-only mode
and stdout contains only its path, session/entry/record/byte counts, SHA-256 checksum, and terminal
manifest. Partial or invalid snapshots are deleted.

Use `--parent-session-id <id>` for exact children or `--root-only` for roots; the two flags are
mutually exclusive. `--agent`, `--version`, `--data`, and `--inactive-for-hours` apply the same
exact filters as session listing. The export always excludes archived sessions.

`snapshot partition` accepts only a generated temporary export path, not a caller-selected
`snapshot export --path` destination. It verifies the terminal schema-1 manifest and may verify
`--checksum <sha256>` plus all four `--sessions`, `--entries`, `--records`, and `--bytes` counts.
It preserves each contiguous session and its ordered entries, defaults to 25 sessions or 1 MiB per
read-only partition, and rejects an oversize session instead of splitting it. `snapshot cleanup`
accepts either generated path, or both, and attempts all requested cleanup safely.

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
