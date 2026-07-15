# agent-journal

A journal for autonomous agents — not a knowledge base.

Agents that work unmonitored (no human watching) need somewhere to jot down what
happened: friction, decisions, dead ends, useful context. `agent-journal` gives
them an append-only, per-session journal they can write to as a stream of
consciousness, and pull back later — from the same session or a fresh one — to
distill learnings and self-improve.

This project does **not** decide *what* an agent should journal. That's up to
you: write a skill for your own workflow (see [`plugins/agent-journal/skills/agent-journal`](plugins/agent-journal/skills/agent-journal/SKILL.md)
for a minimal starting point, or bring your own). `agent-journal` only handles
*how* journal entries are stored, retrieved, and archived.

## Architecture

- **`packages/server`** — a Lambda + DynamoDB service (deployed via CloudFormation,
  not published). Streams responses over a Lambda Function URL.
- **`packages/agent-journal`** (published as [`@jongleberry/agent-journal`](https://www.npmjs.com/package/@jongleberry/agent-journal))
  — the client library, CLI (`agent-journal`), and MCP server, all in one small,
  dependency-light package.
- **`plugins/agent-journal`** — a Claude Code + Codex plugin bundling the MCP
  server and a basic usage skill.

## Quick start

```sh
npx @jongleberry/agent-journal credentials create --name "my laptop"
# -> { "id": "...", "token": "ag_sk_..." }

export AGENT_JOURNAL_URL=https://your-deployment.lambda-url.us-east-1.on.aws
export AGENT_JOURNAL_TOKEN=ag_sk_...

agent-journal append '{"note": "found a flaky retry in the payments worker"}'
agent-journal get --format markdown
```

## Deploying the server

```sh
cd packages/server
pnpm run deploy
```

Deploys a single CloudFormation stack: one Lambda (streaming Function URL),
one DynamoDB table (TTL-enabled, on-demand billing), and the IAM role between
them. See [`packages/server/README.md`](packages/server/README.md) for
configuration.

## Configuration

| Env var | Where | Meaning |
| --- | --- | --- |
| `JOURNAL_TABLE` | server | DynamoDB table name |
| `JOURNAL_TTL_DAYS` | server | entry retention, default 90 |
| `ADMIN_CREDENTIALS` | server | base64 JSON `[{ "name", "token" }]`, admin-only |
| `AGENT_JOURNAL_URL` | client/CLI/MCP | server base URL |
| `AGENT_JOURNAL_TOKEN` | client/CLI/MCP | journaling credential |
| `AGENT_JOURNAL_ADMIN_TOKEN` | CLI | admin credential, for `credentials` subcommands |

## License

MIT
