# Deploying via CloudFormation

A complete, first-time walkthrough for getting `packages/server` running on
your own AWS account. For what each command does under the hood and the
full env var reference, see [`lambda.md`](lambda.md); this doc is the
step-by-step path from a fresh clone to a working, deployed instance.

## 1. Prerequisites

- **Node 24+** and **pnpm**.
- An **AWS account**, with the **AWS CLI** (`aws`) installed and configured:
  ```sh
  aws configure
  # or: aws sso login, or any other standard credential source
  ```
  A region must be resolvable — via `AWS_REGION`/`AWS_DEFAULT_REGION`, or
  `aws configure set region <region>`. `deploy.mjs` fails fast with a clear
  error if none is set.
- **IAM permissions** for the principal running `pnpm run deploy` (this is
  distinct from the Lambda's own runtime role, which the template scopes to
  least privilege — see [`lambda.md`](lambda.md#what-gets-deployed-infratemplateyaml)).
  The deploying principal needs to:
  - Create/read CloudFormation stacks (`cloudformation:*` on this stack).
  - Create the Lambda function, its Function URL, and its IAM role
    (`lambda:*`, `iam:CreateRole`/`PutRolePolicy`/`PassRole`).
  - Create the DynamoDB table and run deploy-time metadata migration
    (`dynamodb:CreateTable`, `DescribeTable`, `GetItem`, `Scan`, `UpdateItem`, and `PutItem`).
  - Create and write to the deploy-artifact S3 bucket
    (`s3:CreateBucket`/`PutObject`/`PutPublicAccessBlock`/`HeadObject`).
  - `sts:GetCallerIdentity` (used to name the deploy bucket deterministically).

  In practice, a broad role (e.g. `AdministratorAccess`, or a
  power-user-equivalent policy) on the deploying principal is the pragmatic
  choice for a personal/small-team deployment; a hardened least-privilege
  deploy policy is out of scope here.

## 2. Install and build

From the repo root:

```sh
pnpm install
pnpm --filter agent-blackboard-server run build
```

(`pnpm run deploy` in the next step runs the build for you too — this step
is just to catch build errors early if you want to.)

## 3. Generate admin credentials

Admin credentials are the only way to create/list/delete client
credentials (`POST /credentials`, etc.) — see
[`architecture.md#auth-model`](architecture.md#auth-model). They live only
in this env var, never in DynamoDB, so generate one now and keep it
somewhere safe (a password manager, a deploy secret store):

```sh
export AGENT_BLACKBOARD_ADMIN_CREDENTIALS=$(node -e "
  const crypto = require('node:crypto');
  const token = 'abb_admin_prod_' + crypto.randomBytes(24).toString('base64url');
  console.log(Buffer.from(JSON.stringify([{ name: 'prod-admin', token }])).toString('base64'));
  console.error('Admin token (save this):', token);
")
```

This prints the raw admin token to stderr (so it doesn't end up in shell
history via `$()`) and sets `AGENT_BLACKBOARD_ADMIN_CREDENTIALS` to the base64-encoded JSON
the server expects. You can list multiple `{ name, token }` admin entries in
that JSON array if more than one person/system needs admin access.

## 4. Deploy

```sh
cd packages/server
pnpm run deploy
```

This bundles the handler, uploads it to a deploy-owned S3 bucket, and runs
`aws cloudformation deploy` — creating the stack on the first run, updating
it on every run after (safe to re-run any time; unchanged code is a no-op
upload). It prints the stack outputs as JSON when it finishes:

```json
{
  "FunctionUrl": "https://abc123xyz.lambda-url.us-east-1.on.aws/",
  "TableName": "agent-blackboard-AgentBlackboardTable-ABC123XYZ"
}
```

First deploys typically take 1–3 minutes (DynamoDB table, IAM role, Lambda,
and Function URL creation). Save `FunctionUrl` — that's your
`AGENT_BLACKBOARD_URL`.

## 5. Create your first client credential

Using the admin token from step 3 and the `FunctionUrl` from step 4:

```sh
export AGENT_BLACKBOARD_URL=https://abc123xyz.lambda-url.us-east-1.on.aws
export AGENT_BLACKBOARD_ADMIN_TOKEN=abb_admin_prod_...   # from step 3

agent-blackboard credentials create --name "my laptop"
# -> { "id": "...", "name": "my laptop", "token": "abb_sk_...", "createdAt": "..." }
```

That `abb_sk_...` token is your `AGENT_BLACKBOARD_TOKEN` — the one your CLI/MCP
config actually uses day to day (see the root
[README](../README.md#configuration)). The admin token from step 3 is only
needed for managing credentials, never for recording entries.

## 6. Verify it end to end

```sh
export AGENT_BLACKBOARD_TOKEN=abb_sk_...   # from step 5

agent-blackboard sessions create deploy-check --agent smoke-test --version 1.0.0
agent-blackboard append --session-id deploy-check '{"note":"first deploy works"}'
agent-blackboard get --session-id deploy-check --format markdown
```

## Redeploying

Just re-run `pnpm run deploy` from `packages/server` after any code change —
it's the same idempotent command for first deploys and updates. Override
`AGENT_BLACKBOARD_TTL_DAYS`/`STACK_NAME` via env vars if you need non-default values.
`deploy.mjs` always requires `AGENT_BLACKBOARD_ADMIN_CREDENTIALS` to be set and re-passes it
on every call (it never relies on CloudFormation reusing a previous
parameter value) — keep it exported in whatever shell/CI environment you
deploy from. After the stack update, deploy also runs a versioned, idempotent table migration that
removes legacy session TTL attributes, recalculates entry TTL from `createdAt`, and backfills
`lastEntryAt`. A migration failure fails the deploy; rerunning safely resumes the migration.

## Tearing down

Use the guarded teardown script from the repo root:

```sh
AWS_REGION=us-west-2 pnpm --filter agent-blackboard-server run teardown -- \
  --confirm agent-blackboard
```

The confirmation value must exactly match `STACK_NAME` (which defaults to
`agent-blackboard`). The script deletes the CloudFormation stack and waits for
deletion to finish. This removes the DynamoDB table (**and all session and entry data
in it**), the Lambda function, its Function URL, and the IAM role.

The deploy-artifact S3 bucket is intentionally retained by default because it
is managed outside the stack. To empty and delete it too:

```sh
AWS_REGION=us-west-2 pnpm --filter agent-blackboard-server run teardown -- \
  --confirm agent-blackboard --delete-artifacts
```

The equivalent manual commands are:

```sh
aws cloudformation delete-stack --stack-name agent-blackboard --region <region>
aws cloudformation wait stack-delete-complete \
  --stack-name agent-blackboard --region <region>
aws s3 rb s3://agent-blackboard-deploy-<account-id>-<region> --force
```

## Troubleshooting

- **`No AWS region configured`** — set `AWS_REGION`, `AWS_DEFAULT_REGION`,
  or `aws configure set region <region>`.
- **`AGENT_BLACKBOARD_ADMIN_CREDENTIALS env var is required`** — see step 3; there's
  deliberately no default (an empty admin list would just make
  `/credentials*` permanently 401).
- **Deploy fails on `ReservedConcurrentExecutions`** — the template reserves
  20 units of concurrency as a DoS backstop. On a fresh/restricted AWS
  account with little unreserved concurrency left (default account limit is
  1000, but some of that may already be reserved by other functions), this
  can fail. Lower `ReservedConcurrentExecutions` in `infra/template.yaml`,
  or request a concurrency limit increase.
- **`Cannot find module '@aws-sdk/lib-dynamodb'` at cold start** — shouldn't
  happen (the bundle deliberately includes the full AWS SDK rather than
  relying on the Lambda runtime's copy — see
  [`lambda.md`](lambda.md#pnpm-run-build)) — if you see this, the build step
  didn't run before deploy, or a stale `dist/lambda.zip` is being reused.
- **`Dynamic require of "node:https" is not supported`** — a real bug hit
  and fixed during this project's first actual deploy, not a hypothetical.
  The AWS SDK's bundled CJS dependencies (`@smithy/node-http-handler`) call
  `require('node:https')`, and esbuild's ESM output only inlines `require()`
  calls it can resolve statically, so that call throws — this reproduces in
  plain local Node just as much as on Lambda (confirmed directly: running
  the actual bundled `dist/handler.mjs` in a child Node process and forcing
  a real `DynamoDBDocumentClient` call reproduces it identically outside
  Lambda). It only ever showed up on the deployed Lambda in practice because
  nothing else in this repo runs the bundled artifact at all — every
  unit/integration test exercises `src/` directly via `tsx`, and the
  bundle/deploy scripts themselves are excluded from coverage (see the
  testing-strategy notes in the original plan) — not because the failure
  needs Lambda's runtime specifically. Fixed in `infra/bundle.mjs` with an
  esbuild `banner` that rebinds `require` to `node:module`'s
  `createRequire(import.meta.url)`, which resolves builtins like any real
  CJS `require()` would.
  [`bundle.regression.test.mts`](../packages/server/src/bundle.regression.test.mts)
  guards against this regressing — it builds the real bundle, runs it in a
  genuine child Node process, and forces an actual `send()` call against a
  bogus endpoint (fast and hermetic, no real AWS needed) to confirm
  `node:https` still resolves. If you see this error again, that test
  should already be failing in CI.
