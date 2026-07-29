# Lambda / server commands

Commands for `packages/server` — the Lambda + DynamoDB storage service.
Run from the repo root or from `packages/server/` (`pnpm --filter
agent-blackboard-server run <script>` vs. `pnpm run <script>` inside the
package directory). This package is **deployed, never published to npm**.

## `pnpm run dev`

Runs `tsx src/local-server.mts` directly — no build step. Starts a
`node:http` server (default port `3000`, override with `PORT`) that adapts
requests into the same `handleRequest` core the Lambda handler uses.

```sh
AGENT_BLACKBOARD_STORE=memory \
AGENT_BLACKBOARD_ADMIN_CREDENTIALS=$(node -e "console.log(Buffer.from(JSON.stringify([{name:'local-admin',token:'abb_admin_local_dev'}])).toString('base64'))") \
  pnpm run dev
```

With `AGENT_BLACKBOARD_STORE=memory`, it uses an in-memory store — no AWS account or
DynamoDB needed at all. Omit it (or set it to anything else) to run against
a real DynamoDB table, including [DynamoDB
Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)
via the standard AWS SDK env vars (`AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`).

## `pnpm run build`

Runs `infra/bundle.mjs`: esbuild-bundles `src/handler.mts` and its full
dependency graph (including `@aws-sdk/*` — see below) into
`dist/handler.mjs`, writes a minimal `dist/package.json` (`{"type":
"module"}` so Lambda knows it's ESM), and zips both into `dist/lambda.zip`.

Third-party packages are bundled in, not externalized: the AWS-managed
Lambda runtime does ship an SDK, but its exact version isn't a documented,
versioned contract, and externalizing risks a `Cannot find module` (or
subtly-incompatible-version) failure at cold start. The tradeoff costs
~1.2MB of zip size — fine for a service this small.

## `pnpm run deploy`

See [`cloudformation.md`](cloudformation.md) for a full first-time
walkthrough (prerequisites, generating admin credentials, verifying the
deploy, tearing down). This section covers what the command does
internally.

Runs `infra/deploy.mjs`, which:

1. Runs the build step above.
2. Ensures a deploy-artifact S3 bucket exists
   (`agent-blackboard-deploy-<account-id>-<region>`), created idempotently.
   S3 is required because `AWS::Lambda::Function.Code.ZipFile` (inline code)
   is capped at ~4KB — nowhere near enough for a bundled dependency graph.
3. Uploads `dist/lambda.zip` under a **content-hash key**
   (`lambda/<sha256>.zip`), skipped if already present — re-running `deploy`
   with unchanged code is a no-op upload.
4. Runs a single idempotent `aws cloudformation deploy` against
   `infra/template.yaml` — creates the stack on first run, updates it
   (table, role, function, Function URL) on every run after. The changed S3
   key alone signals to CloudFormation that the function code changed; no
   separate `update-function-code` call is needed.
5. Migrates legacy records idempotently: session TTL attributes are removed, entry TTL values are
   based on each entry's `createdAt`, and session `lastEntryAt` is backfilled.
6. Prints the stack outputs (`FunctionUrl`, `TableName`) via
   `aws cloudformation describe-stacks`.

```sh
AGENT_BLACKBOARD_ADMIN_CREDENTIALS=$(node -e "console.log(Buffer.from(JSON.stringify([{name:'prod-admin',token:'abb_admin_prod_<random>'}])).toString('base64'))") \
  pnpm run deploy
```

`AGENT_BLACKBOARD_ADMIN_CREDENTIALS` is required — there's no default, since an empty admin
list would just make `/credentials*` permanently 401 on a fresh deploy.
Override `AGENT_BLACKBOARD_TTL_DAYS`/`STACK_NAME` via env vars.

**Prerequisites**: an AWS account and the AWS CLI (`aws`), configured with
credentials that can manage CloudFormation, Lambda, IAM roles, DynamoDB, and
S3.

## `pnpm run typecheck`

`tsc --noEmit --project tsconfig.json` for this package only.

## What gets deployed (`infra/template.yaml`)

A single CloudFormation stack:

- **`AgentBlackboardTable`** (`AWS::DynamoDB::Table`) — `PK`/`SK` string keys,
  `PAY_PER_REQUEST` billing, TTL enabled on `ttl`.
- **`AgentBlackboardFunction`** (`AWS::Lambda::Function`) — runtime `nodejs24.x`,
  `MemorySize: 256`, `Timeout: 60`, `ReservedConcurrentExecutions: 20` (a DoS
  backstop for the public endpoint — raise it if you expect more concurrent
  traffic; on a fresh/restricted AWS account with little unreserved
  concurrency, deploy can fail here specifically).
- **`AgentBlackboardFunctionRole`** (`AWS::IAM::Role`) — scoped to exactly
  `GetItem`/`PutItem`/`Query`/`UpdateItem`/`DeleteItem` on the one table ARN,
  plus `CloudWatch Logs` write access to its own log group. Nothing broader.
- **`AgentBlackboardFunctionUrl`** (`AWS::Lambda::Url`) — `AuthType: NONE`,
  `InvokeMode: RESPONSE_STREAM`. Publicly reachable by design; the handler
  itself validates the bearer token on every request. `AWS_IAM` auth was
  rejected because it'd require every caller to sign requests with AWS
  credentials, defeating the point of a portable bearer token agents carry
  in an env var.

## Configuration

| Var                                  | Used by                                 | Meaning                                                                                                                   |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_BLACKBOARD_TABLE`             | handler, local-server                   | DynamoDB table name. Default `AgentBlackboard`; on the deployed Lambda, always set from the CloudFormation-managed table. |
| `AGENT_BLACKBOARD_TTL_DAYS`          | handler, local-server                   | Retention for each entry from its `createdAt`. Default `90`; session metadata never expires.                              |
| `AGENT_BLACKBOARD_ADMIN_CREDENTIALS` | handler, local-server                   | Base64 JSON `[{ "name", "token" }]`. Never written to DynamoDB. Unset = `/credentials*` always 401s.                      |
| `AGENT_BLACKBOARD_STORE`             | local-server only                       | Set to `memory` to use the in-memory store instead of DynamoDB.                                                           |
| `PORT`                               | local-server only                       | Listen port for `pnpm run dev`. Default `3000`.                                                                           |
| `AWS_REGION`                         | handler, local-server (via the AWS SDK) | Region for the DynamoDB client — read automatically by `@aws-sdk/client-dynamodb`'s default provider chain.               |

## Testing

`pnpm exec vitest run packages/server/src` from the repo root. Unit tests
run against the in-memory store and fake req/response objects — no AWS
account needed. `store/dynamo.integration.test.mts` exercises the real
DynamoDB store against a live endpoint (`DYNAMODB_ENDPOINT` env var, e.g.
DynamoDB Local in CI) and skips gracefully when that endpoint isn't set.
