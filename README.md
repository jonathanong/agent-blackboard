# atel

A telemetry stream for autonomous agents — not a knowledge base.

Agents that work unmonitored (no human watching) need somewhere to jot down what
happened: friction, decisions, dead ends, useful context. `atel` gives
them an append-only, per-session telemetry stream they can write to as a stream of
consciousness, and pull back later — from the same session or a fresh one — to
distill learnings and self-improve.

This project does **not** decide _what_ an agent should record. That's up to
you: write a skill for your own workflow (see [`plugins/atel/skills/atel`](plugins/atel/skills/atel/SKILL.md)
for a minimal starting point, or bring your own). `atel` only handles
_how_ telemetry entries are stored, retrieved, and archived.

## Architecture

- **`packages/server`** — a Lambda + DynamoDB service (deployed via CloudFormation,
  not published to npm). Streams responses over a Lambda Function URL.
- **`packages/atel`** (published as [`atel`](https://www.npmjs.com/package/atel))
  — the client library, CLI (`atel`), and MCP server, all in one small,
  dependency-light package.
- **`plugins/atel`** — a Claude Code + Codex plugin bundling the MCP
  server and a basic usage skill.

## Quick start

```sh
npx atel credentials create --name "my laptop"
# -> { "id": "...", "token": "atl_sk_..." }

export ATEL_URL=https://your-deployment.lambda-url.us-east-1.on.aws
export ATEL_TOKEN=atl_sk_...

atel append '{"note": "found a flaky retry in the payments worker"}'
# --all-sessions: from a plain shell, each invocation is a separate process
# with no session to inherit, so append and get land in different
# auto-generated sessions unless you pass --session-id yourself. Inside
# Claude Code/Codex, session id is resolved automatically instead — see
# docs/architecture.md#session-lifecycle.
atel get --all-sessions --format markdown
```

## Deploying the server

```sh
cd packages/server
pnpm run deploy
```

Deploys a single CloudFormation stack: one Lambda (streaming Function URL),
one DynamoDB table (TTL-enabled, on-demand billing), and the IAM role between
them. See [`docs/cloudformation.md`](docs/cloudformation.md) for a full
first-time walkthrough (prerequisites, generating admin credentials,
verifying the deploy, tearing down), or
[`packages/server/README.md`](packages/server/README.md) for package-level
configuration.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — request flow, data model, auth model, session lifecycle
- [`docs/cloudformation.md`](docs/cloudformation.md) — step-by-step deploy walkthrough
- [`docs/lambda.md`](docs/lambda.md) — server commands (`dev`/`build`/`deploy`) and what gets deployed
- [`docs/cli.md`](docs/cli.md) — every CLI command
- [`docs/mcp.md`](docs/mcp.md) — every MCP tool
- [`docs/agent-hosts.md`](docs/agent-hosts.md) — how the Claude Code and Codex plugins work, their gotchas, and recommendations
- [`docs/smoke-test.md`](docs/smoke-test.md) — a prompt for dispatching a real agent to test the plugin end to end
- [`docs/loop-engineering.md`](docs/loop-engineering.md) — how to build a self-improvement loop on top of this

## Configuration

| Env var                  | Where          | Meaning                                         |
| ------------------------ | -------------- | ----------------------------------------------- |
| `ATEL_TABLE`             | server         | DynamoDB table name                             |
| `ATEL_TTL_DAYS`          | server         | entry retention, default 90                     |
| `ATEL_ADMIN_CREDENTIALS` | server         | base64 JSON `[{ "name", "token" }]`, admin-only |
| `ATEL_URL`               | client/CLI/MCP | server base URL                                 |
| `ATEL_TOKEN`             | client/CLI/MCP | telemetry credential                            |
| `ATEL_ADMIN_TOKEN`       | CLI            | admin credential, for `credentials` subcommands |

## License

MIT
