# agent-blackboard server

The deployed, unpublished storage service: one Lambda Function URL and one DynamoDB table managed
by CloudFormation.

## Layout

- `src/core` — framework-neutral routing, validation, formatting, and responses.
- `src/store` — `BlackboardStore`, DynamoDB implementation, and in-memory implementation.
- `src/auth` — client credentials from DynamoDB and admin credentials from environment config.
- `src/handler.mts` — Lambda adapter.
- `src/local-server.mts` — local Node HTTP adapter.
- `infra` — bundle, deploy, teardown, and CloudFormation template.

## Local development

```sh
AGENT_BLACKBOARD_STORE=memory \
AGENT_BLACKBOARD_ADMIN_CREDENTIALS=<base64-admin-json> \
pnpm run dev
```

The server listens on `PORT` (default `3000`). With the memory store, no AWS account is needed.

```sh
curl -X POST http://localhost:3000/sessions \
  -H 'authorization: Bearer abb_sk_...' -H 'content-type: application/json' \
  -d '{"id":"root-123","parentSessionId":null}'

curl -X POST http://localhost:3000/sessions/root-123/entries \
  -H 'authorization: Bearer abb_sk_...' -H 'content-type: application/json' \
  -d '{"data":{"note":"hello"}}'

curl http://localhost:3000/sessions/root-123/entries \
  -H 'authorization: Bearer abb_sk_...'
```

## Commands

```sh
pnpm run dev
pnpm run build
pnpm run deploy
pnpm run teardown
```

`deploy` bundles the Lambda, uploads a content-addressed zip to the deployment bucket, deploys the
stack, and prints outputs. `teardown` deletes the stack and waits for completion; its explicit
`--delete-artifacts` flag also empties and removes the deployment bucket. `STACK_NAME` overrides the
default `agent-blackboard` stack name.

## Environment

| Variable                             | Meaning                                   |
| ------------------------------------ | ----------------------------------------- |
| `AGENT_BLACKBOARD_TABLE`             | DynamoDB table; default `AgentBlackboard` |
| `AGENT_BLACKBOARD_TTL_DAYS`          | Entry retention; default 90 days          |
| `AGENT_BLACKBOARD_ADMIN_CREDENTIALS` | Base64 JSON `[{ "name", "token" }]`       |
| `AGENT_BLACKBOARD_STORE=memory`      | Use memory storage locally                |
| `PORT`                               | Local port; default 3000                  |

## Storage

The table contains separate session, entry, and credential items. A session item owns
`parentSessionId` and `archivedAt`; every entry has its own item and composite public identity
`(sessionId, createdAt)`. DynamoDB transactions enforce active-session conditions while creating
children and writing entries.

The Lambda IAM role needs `GetItem`, `PutItem`, `Query`, `UpdateItem`, `DeleteItem`,
`ConditionCheckItem`, and `TransactWriteItems` on this table.
