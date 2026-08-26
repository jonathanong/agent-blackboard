# agent-blackboard

Client library, CLI, and MCP server for [agent-blackboard](https://github.com/jonathanong/agent-blackboard).
Requires Node 24+ and talks to a separately deployed HTTP service over `fetch`.

See the complete [TypeScript API reference](https://github.com/jonathanong/agent-blackboard/blob/master/docs/typescript-api.md)
for the supported public surface and tooling integration details.

```sh
pnpm add agent-blackboard
```

## Library

```ts
import { Auth, Entries, Sessions, Snapshots } from 'agent-blackboard'

const config = { baseUrl, token }
const sessions = new Sessions(config)
const entries = new Entries(config)
const snapshots = new Snapshots(config)

await sessions.create({
  id: 'root-123',
  parentSessionId: null,
  agent: 'claude-code',
  version: '1.0.13',
})
await sessions.create({
  id: 'worker-456',
  parentSessionId: 'root-123',
  agent: 'claude-code',
  version: '1.0.13',
})
await sessions.patch({ sessionId: 'worker-456', data: { branch: 'fix/retry' } })

await entries.append({
  sessionId: 'worker-456',
  data: { note: 'found a flaky retry' },
})

for await (const current of entries.get({ sessionId: 'worker-456' })) {
  console.log(current)
}

await sessions.archive('worker-456')

// The JSONL file stays local; the result contains only its verification metadata.
const snapshot = await snapshots.export({ selection: { agent: 'claude-code' } })
console.log(snapshot.path, snapshot.checksum.value)

const auth = new Auth({ baseUrl, adminToken })
await auth.createCredentials({ name: 'ci-bot' })
```

All session ids, agent names, and versions are caller-provided. `parentSessionId` is required and
nullable. The service generates `createdAt`/`lastEntryAt`/`archivedAt` timestamps.
`Entries.get()` returns an `AsyncIterable<SessionEntry>` and uses incremental JSONL by default.
Non-2xx responses throw `AgentBlackboardError`. Use the root `formatError(error)` export when
rendering a caught value for users; it includes an `AgentBlackboardError` response body when present
and safely handles any value JavaScript can throw. Unserializable response bodies and unprintable
thrown values use deterministic fallback text instead of throwing while reporting the error.

## CLI

```sh
agent-blackboard sessions create root-123 --agent claude-code --version 1.0.13
agent-blackboard sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
agent-blackboard sessions patch worker-456 --data '{"branch":"fix/retry"}'
agent-blackboard sessions list
agent-blackboard sessions list --inactive-for-hours 8
agent-blackboard sessions get worker-456
agent-blackboard append --session-id worker-456 '{"note":"investigating"}'
agent-blackboard append --session-id worker-456 --file findings.md
agent-blackboard get --session-id worker-456 --format jsonl
agent-blackboard sessions archive worker-456
agent-blackboard snapshot export --root-only --inactive-for-hours 8
agent-blackboard mcp
```

## MCP

The stdio MCP server exposes `session_create`, `session_ensure`, `session_search`, `session_patch`,
`session_archive`, `entry_append`, `entry_get`, and `snapshot_export`. `snapshot_export` writes a
private, read-only JSONL file and returns only its path, counts, checksum, and terminal manifest;
it never puts snapshot records on the MCP connection. Every session and entry operation requires
explicit session ids where applicable. Credential management remains CLI/admin-only.

## Configuration

| Variable                       | Used by         | Meaning                            |
| ------------------------------ | --------------- | ---------------------------------- |
| `AGENT_BLACKBOARD_URL`         | CLI/MCP         | Service base URL                   |
| `AGENT_BLACKBOARD_TOKEN`       | CLI/MCP         | Client credential (`abb_sk_...`)   |
| `AGENT_BLACKBOARD_ADMIN_TOKEN` | CLI credentials | Admin credential (`abb_admin_...`) |

Client and admin tokens are never interchangeable.

## License

MIT
