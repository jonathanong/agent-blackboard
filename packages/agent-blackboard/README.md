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
import { Auth, Entries, Sessions } from 'agent-blackboard'

const config = { baseUrl, token }
const sessions = new Sessions(config)
const entries = new Entries(config)

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

const auth = new Auth({ baseUrl, adminToken })
await auth.createCredentials({ name: 'ci-bot' })
```

All session ids, agent names, and versions are caller-provided. `parentSessionId` is required and
nullable. The service only generates `createdAt`/`archivedAt` timestamps. `Entries.get()` returns an
`AsyncIterable<SessionEntry>` and uses incremental JSONL by default. Non-2xx responses throw
`AgentBlackboardError`.

## CLI

```sh
agent-blackboard sessions create root-123 --agent claude-code --version 1.0.13
agent-blackboard sessions create worker-456 --parent-session-id root-123 \
  --agent claude-code --version 1.0.13
agent-blackboard sessions patch worker-456 --data '{"branch":"fix/retry"}'
agent-blackboard sessions list
agent-blackboard sessions get worker-456
agent-blackboard append --session-id worker-456 '{"note":"investigating"}'
agent-blackboard append --session-id worker-456 --file findings.md
agent-blackboard get --session-id worker-456 --format jsonl
agent-blackboard sessions archive worker-456
agent-blackboard mcp
```

## MCP

The stdio MCP server exposes `session_create`, `session_search`, `session_patch`, `session_archive`,
`entry_append`, and `entry_get`. Every session and entry operation requires explicit session ids
where applicable. Credential management remains CLI/admin-only.

## Configuration

| Variable                       | Used by         | Meaning                            |
| ------------------------------ | --------------- | ---------------------------------- |
| `AGENT_BLACKBOARD_URL`         | CLI/MCP         | Service base URL                   |
| `AGENT_BLACKBOARD_TOKEN`       | CLI/MCP         | Client credential (`abb_sk_...`)   |
| `AGENT_BLACKBOARD_ADMIN_TOKEN` | CLI credentials | Admin credential (`abb_admin_...`) |

Client and admin tokens are never interchangeable.

## License

MIT
