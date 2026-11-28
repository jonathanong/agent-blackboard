# CLI commands

The `agent-blackboard` CLI uses `AGENT_BLACKBOARD_URL` plus either
`AGENT_BLACKBOARD_TOKEN` for sessions/entries/schema reads or `AGENT_BLACKBOARD_ADMIN_TOKEN` for
credentials and schema admin commands (`put`, `promote`, `report`, `remove`). Client and admin
credentials are never interchangeable.

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
agent-blackboard sessions list --data-array-contains '{"repositories":"owner/repo"}'
agent-blackboard sessions list --limit 1
agent-blackboard sessions get worker-456
agent-blackboard sessions archive worker-456
```

`sessions create` requires `--version` and always sends `parentSessionId`: it is `null` when the
parent flag is omitted. An omitted `<session-id>` or `--agent` is resolved from the harness
environment (see
[session-id resolution](session-id-resolution.md), including `--root-codex`). `sessions ensure` takes the same flags as `sessions create` but is idempotent: if the
session already exists, it verifies `parentSessionId`/`agent`/`version` match instead of erroring,
returning `{"status":"created"|"exists","session":...}` either way — a mismatch still throws.
`sessions patch` shallow-merges a non-empty JSON object into session `data`. Listing
defaults to undistilled sessions; use `--archived true` to list archived sessions. Use
`--inactive-for-hours <hours>` to keep only sessions whose last entry is strictly older than the
cutoff; a session without entries is treated as last active at its `createdAt`. Use `--limit <n>` to fetch a single bounded page
instead of draining every page (the flag omitted otherwise drains the full result set into one flat
JSON array). The store applies filters after the page limit, so a `--limit` page can be shorter than
`n` (even empty) while more matching sessions exist further in the table; use it for a cheap
connectivity probe, not a reliable existence or count check. Archived session metadata cannot be
patched, but entries may still be appended and children
may reference an archived parent.

Use `--data-array-contains <json>` to match exact string membership in array-valued session data,
for example `{"repositories":"owner/repo"}`. Every listed field must be an array containing its
requested string.

## Entries

```sh
agent-blackboard append --session-id worker-456 '{"note":"found the edge case"}'
agent-blackboard append --session-id worker-456 --schema finding '{"title":"flaky retry"}'
agent-blackboard append --session-id worker-456 --schema finding@1 '{"title":"flaky retry"}'
agent-blackboard append --session-id worker-456 < entry.json
agent-blackboard append --session-id worker-456 --file entry.json
agent-blackboard append --session-id worker-456 --file findings.md
agent-blackboard append --session-id worker-456 --file notes.txt
agent-blackboard get --session-id worker-456 --format json
agent-blackboard get --session-id worker-456 --format jsonl
agent-blackboard get --session-id worker-456 --format markdown
```

`append` and `get` take `--session-id`, or resolve it from the harness environment when omitted.
Pass `--schema <id>[@<version>]` to validate the entry against a registered JSON Schema on the
server (latest version if `@<version>` is omitted), and optional `--source-event-id <id>` for
per-session idempotent writes (identical retries return the stored entry with `duplicate: true`;
conflicting content fails with HTTP `409`). Entries are append-only: there is no `patch`
command for entries; to record an update, append a new entry. Reads stream bytes to stdout without
buffering the full response.

For `append --file`, `.json` files must contain a JSON object. `.md` and `.markdown` files are sent
as `{ "markdown": "..." }`; `.txt` files are sent as `{ "text": "..." }`.

## Snapshots

```sh
agent-blackboard snapshot export
agent-blackboard snapshot export --path /absolute/path/evidence.jsonl
agent-blackboard snapshot export --root-only --inactive-for-hours 8
agent-blackboard snapshot export --data-array-contains '{"repositories":"owner/repo"}'
agent-blackboard snapshot export --agent codex --version 1.0.0 \
  --data '{"repository":"example/tooling"}'
agent-blackboard snapshot partition --path /tmp/agent-blackboard-snapshot-<uuid>.jsonl \
  --cleanup-token <cleanup-token>
agent-blackboard snapshot cleanup --path /tmp/agent-blackboard-snapshot-<uuid>.jsonl \
  --directory /tmp/agent-blackboard-partitions-<suffix> --cleanup-token <cleanup-token>
```

The command streams every matching unarchived session and entry into a newly created private file.
If `--path` is omitted, it creates a unique file under the system temporary directory. A supplied
path must be absolute and must not already exist. On success the file is changed to read-only mode
and stdout contains only its path, session/entry/record/byte counts, SHA-256 checksum, and terminal
manifest. Partial or invalid snapshots are deleted.

Use `--parent-session-id <id>` for exact children or `--root-only` for roots; the two flags are
mutually exclusive. `--agent`, `--version`, `--data`, and `--inactive-for-hours` apply the same
exact filters as session listing. The export always excludes archived sessions.

`snapshot partition` accepts only a generated temporary export path and its cleanup token, not a caller-selected
`snapshot export --path` destination. It verifies the terminal schema-1 manifest and may verify
`--checksum <sha256>` plus all four `--sessions`, `--entries`, `--records`, and `--bytes` counts.
It preserves each contiguous session and its ordered entries, defaults to 25 sessions or 1 MiB per
read-only partition, and rejects an oversize session instead of splitting it. `snapshot cleanup`
requires the same cleanup token and accepts either generated path, or both, attempting all requested
cleanup safely. The token is printed in the compact JSON result from `snapshot export`.

## Schemas

```sh
# Client commands (AGENT_BLACKBOARD_TOKEN)
agent-blackboard schemas pull [--dir <path>]
agent-blackboard schemas list
agent-blackboard schemas get finding
agent-blackboard schemas get finding@1

# Offline validation against the local pulled copy (no network or token required)
agent-blackboard schemas validate finding entry.json [--dir <path>]
agent-blackboard schemas validate finding@1 entry.json

# Admin commands (AGENT_BLACKBOARD_ADMIN_TOKEN)
agent-blackboard schemas put finding finding.schema.json
agent-blackboard schemas put finding finding.schema.json --breaking
agent-blackboard schemas put finding finding.schema.json --shadow
agent-blackboard schemas report finding
agent-blackboard schemas report finding@1 --limit 25
agent-blackboard schemas promote finding@1
agent-blackboard schemas remove finding
```

The registry accepts JSON Schema Draft 2020-12 only, rejects schemas that fail to compile, and
disallows remote `$ref`s (only internal `#...` pointers and references to other registered schemas
`<id>` or `<id>@<version>` are permitted). Every `put` publishes a new immutable version `<id>@<n>`
and advances the server's registry revision. Breaking changes (new required fields, removed
properties, narrowed types or constraints) are refused with HTTP `409` unless `--breaking` is
passed. Passing `--shadow` registers the version in shadow mode: entries naming it are validated,
but failures are accepted (`201`) with a `warning` in the write response and recorded server-side
(schema id, version, session, time, and validation diagnostics — never the entry payload). Admins
can inspect counts and recent failures with `schemas report <id>[@<version>]` and switch a shadow
version to enforced with `schemas promote <id>@<version>`. `remove` marks a schema deprecated so
new writes against it are rejected while keeping all historical versions readable.

`schemas pull` stores the local copy under `<worktree>/.local/agent-blackboard/schemas` (override
with `AGENT_BLACKBOARD_SCHEMAS_DIR` or `--dir`) with `manifest.json`, `latest/<id>.json`, and
`versions/<id>@<version>.json`, sending `If-None-Match` so an up-to-date client receives
`304 Not Modified`. Whenever another network CLI command (`sessions`, `append`, `get`,
`snapshot export`, `schemas list|get|put|promote|report|remove`) observes a newer
`x-schema-registry-revision` header than the local manifest, it prints one notice line on `stderr`
telling you to run `agent-blackboard schemas pull` (`credentials` and `mcp` do not emit this
notice).

## Credentials

```sh
agent-blackboard credentials create --name "my laptop"
agent-blackboard credentials list
agent-blackboard credentials delete --name "my laptop"
agent-blackboard credentials delete --id <credential-id>
```

Creating a credential prints its raw token once. Names are not unique; deletion by name removes all
matches. Credential commands are never exposed over MCP.

## Outbox

When `agent-blackboard append` cannot reach the server (network error, `5xx`, `429`, `408`, or
expired `401` credential), it buffers the entry in `<worktree>/.local/agent-blackboard/outbox`
(override with `AGENT_BLACKBOARD_OUTBOX_DIR`), exits `0`, and prints a JSON object with
`"queued": true` (so callers that check exit status should inspect `queued` if they need to
distinguish immediate delivery from buffered writes). Permanent `4xx` rejections (such as `400`,
`403`, `404`, or `409`) still fail immediately with a non-zero exit code without queuing.

```sh
agent-blackboard outbox status [--dir <path>]
agent-blackboard outbox flush [--session-id <id>] [--dir <path>]
agent-blackboard outbox prune [--id <id>] [--session-id <id>] [--dir <path>]
```

`outbox status` reports pending and rejected counts per session plus rejected error details without
contacting the server. `outbox flush` delivers queued entries in order (preserving `sourceEventId`
for idempotency) and moves permanent `4xx` rejections aside into `rejected/` so they do not block
the queue. `outbox prune` removes rejected records after inspection or repair.

## MCP server

```sh
agent-blackboard mcp
```

See [MCP tools](mcp.md).
