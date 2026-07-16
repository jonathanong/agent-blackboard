# atel-server (not published)

The `atel` storage service: one Lambda function (streaming Function
URL) + one DynamoDB table, deployed with a single CloudFormation template via
the AWS CLI. This package is deployed, never published to npm.

## Layout

- `src/core/` — framework-agnostic routing/auth/business logic
  (`handleRequest`). No knowledge of Lambda or `node:http`.
- `src/store/` — `TelemetryStore` interface, a DynamoDB-backed implementation
  (`store/dynamo.mts`), and an in-memory one (`store/memory.mts`) for tests
  and local dev.
- `src/auth/` — admin (env-based) and telemetry (DB-based) credential
  resolution.
- `src/handler.mts` — the Lambda entrypoint (`awslambda.streamifyResponse`).
- `src/local-server.mts` — a `node:http` adapter for local dev and for
  CLI/MCP integration tests to run against.
- `infra/` — `template.yaml` (CloudFormation), `bundle.mjs` (esbuild
  packaging), `deploy.mjs` (deploy orchestration).

Both `handler.mts` and `local-server.mts` are thin adapters over the same
`handleRequest(request, deps)` core — they only translate between their
respective request/response shapes (Lambda Function URL event vs.
`node:http`) and stream the response back chunk-by-chunk as it's produced.

## Prerequisites

- Node 24+, `pnpm`.
- For real (non-`memory`) local dev or deploying: an AWS account and the AWS
  CLI (`aws`), configured (`aws configure` or equivalent) with credentials
  that can manage CloudFormation, Lambda, IAM roles, DynamoDB, and S3 (for
  the deploy-artifact bucket — see [Deploying](#deploying)).

## Local dev

```sh
ATEL_STORE=memory ATEL_ADMIN_CREDENTIALS=$(node -e "console.log(Buffer.from(JSON.stringify([{name:'local-admin',token:'atl_admin_local_dev'}])).toString('base64'))") \
  pnpm run dev
```

`pnpm run dev` runs `tsx src/local-server.mts` directly — no build step. With
`ATEL_STORE=memory`, it uses an in-memory store instead of DynamoDB, so
local dev needs **no AWS account at all**. Omit `ATEL_STORE` (or set it to
anything other than `memory`) to run against a real DynamoDB table (or
[DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)
via the standard `AWS_ENDPOINT_URL`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
env vars the AWS SDK already understands).

The server listens on `PORT` (default `3000`) and logs which store it's
using on startup. Hit it directly:

```sh
curl -X POST http://localhost:3000/credentials \
  -H 'authorization: Bearer atl_admin_local_dev' -H 'content-type: application/json' \
  -d '{"name":"my laptop"}'
# -> { "id": "...", "name": "my laptop", "token": "atl_sk_...", "createdAt": "..." }

curl -X POST http://localhost:3000/telemetry \
  -H 'authorization: Bearer atl_sk_...' -H 'content-type: application/json' \
  -d '{"sessionId":"s1","agent":"claude-code","data":{"note":"hello"}}'

curl http://localhost:3000/telemetry -H 'authorization: Bearer atl_sk_...'
```

## Environment variables

| Var                      | Used by                                 | Meaning                                                                                                                                               |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATEL_TABLE`             | handler, local-server                   | DynamoDB table name. Defaults to `Atel` (and, on the deployed Lambda, is always set from the CloudFormation-managed table — see template.yaml).       |
| `ATEL_TTL_DAYS`          | handler, local-server                   | Entry retention in days. Default `90`.                                                                                                                |
| `ATEL_ADMIN_CREDENTIALS` | handler, local-server                   | Base64 JSON `[{ "name", "token" }]`. Admin-only; never written to DynamoDB. Unset = no admin access (`/credentials*` always 401s).                    |
| `ATEL_STORE`             | local-server only                       | Set to `memory` to use the in-memory store instead of DynamoDB.                                                                                       |
| `PORT`                   | local-server only                       | Listen port for `pnpm run dev`. Default `3000`.                                                                                                       |
| `AWS_REGION`             | handler, local-server (via the AWS SDK) | Region for the DynamoDB client. Read automatically by `@aws-sdk/client-dynamodb`'s default provider chain — not read directly by this package's code. |

## Testing

`pnpm exec vitest run packages/server/src` from the repo root (or `pnpm
--filter atel-server test` once wired at the root). Unit tests use
the in-memory store and, for `handler.mts`/`local-server.mts`, fake
req/response objects — no AWS account needed. Integration tests against a
real DynamoDB (via DynamoDB Local) skip gracefully when no local endpoint is
configured (see `store/`'s own tests).

### Coverage tradeoffs

100% coverage is enforced project-wide. `handler.mts` needs **no**
`/* v8 ignore */` at all — the only file with exclusions is
`local-server.mts`:

- **`handler.mts`**: the final `awslambda.streamifyResponse(...)` binding
  requires the real `awslambda` global, which the Lambda Node runtime only
  injects when `InvokeMode: RESPONSE_STREAM` is set — it doesn't exist
  outside that runtime. `handler.test.mts` polyfills it, so the binding
  itself — plus a full end-to-end smoke test through the real
  `handleRequest` and a real DynamoDB store construction — runs under
  vitest with no exclusion needed. All the request-parsing/
  response-streaming logic is extracted into plain, injectable functions
  (`parseFunctionUrlEvent`, `streamResponseBody`, `handle`) tested directly
  with fakes.
- **`local-server.mts`**: two small `/* v8 ignore */` blocks — (1) the
  script-entrypoint `if (isMain)` block (only runs under `node
local-server.mts`, not under vitest; the logic it wires together is
  covered via the exported `storeFromProcess`/`adminEnvFromProcess`
  helpers), and (2) a last-resort `.catch()` backstop around `respond()` in
  `createServer` for a failure mode (e.g. `res.end()` itself throwing) that
  isn't reproducible through any request a real HTTP client can send —
  `respond()`'s own try/catches already cover every error reachable through
  normal traffic (verified directly, including a `writeHead()`-throws case
  and a socket-`write()`-fails case).

No blanket per-file `coverage.exclude` entries were needed for either file —
see `vitest.config.mts` at the repo root.

## Deploying

```sh
ATEL_ADMIN_CREDENTIALS=$(node -e "console.log(Buffer.from(JSON.stringify([{name:'prod-admin',token:'atl_admin_prod_<random>'}])).toString('base64'))") \
  pnpm run deploy
```

`pnpm run deploy` (`infra/deploy.mjs`) does, in order:

1. Runs `infra/bundle.mjs`: esbuild-bundles `src/handler.mts` (and its
   full dependency graph — see below) into `dist/handler.mjs`, writes a
   minimal `dist/package.json` (`{"type":"module"}`, so Lambda knows the
   bundle is ESM), and zips both into `dist/lambda.zip`.
2. Ensures a deploy-artifact S3 bucket exists
   (`agent-journal-deploy-<account-id>-<region>`) — created idempotently on
   first deploy, owned by this script (not part of the CloudFormation
   stack). **Why S3 at all**: `AWS::Lambda::Function.Code.ZipFile` (inline
   code in the template) is capped at ~4KB and doesn't support a
   dependency-bundled ESM package — the code has to live somewhere
   CloudFormation can reference, and S3 is the standard, native mechanism
   (`Code.S3Bucket`/`Code.S3Key`) rather than a second bespoke deploy path.
3. Uploads `dist/lambda.zip` to that bucket under a **content-hash key**
   (`lambda/<sha256>.zip`, skipped if already present) — so re-running
   `deploy` with unchanged code is a no-op for that upload, and
   `aws cloudformation deploy` only updates the Lambda's code when the hash
   (hence the S3 key) actually changed.
4. Runs `aws cloudformation deploy --template-file infra/template.yaml
--stack-name agent-journal --capabilities CAPABILITY_IAM
--parameter-overrides ...` — a single idempotent call that creates the
   stack on first run and updates it (table, role, function, Function URL)
   on every subsequent run. No separate `update-function-code` call needed —
   the S3 key change alone tells CloudFormation the code changed.
5. Prints the stack outputs (`FunctionUrl`, `TableName`) via
   `aws cloudformation describe-stacks`.

The CloudFormation stack name (`agent-journal`), the deploy-artifact S3
bucket naming pattern, and the CloudFormation template's internal logical
resource IDs (`JournalTable`, `JournalFunction`, etc.) are intentionally
**not** rebranded to "atel" — this repo already has a live, deployed
`agent-journal` stack, and renaming any of those would make CloudFormation
replace (delete + recreate) real, already-deployed resources — including the
DynamoDB table's data — on the next deploy. Only the app-level Lambda
environment variable names (`ATEL_TABLE`/`ATEL_TTL_DAYS`/
`ATEL_ADMIN_CREDENTIALS`) were renamed; those are safe, in-place config
updates.

Override `JournalTtlDays`/`STACK_NAME` via the `ATEL_TTL_DAYS`/
`STACK_NAME` env vars; `ATEL_ADMIN_CREDENTIALS` is required (no default — an
empty admin list would just make `/credentials*` permanently 401, which is
almost certainly not what you want on a fresh deploy).

### Why bundle `@aws-sdk/*` instead of externalizing it

`infra/bundle.mjs` sets `external: []` deliberately — the AWS-managed Lambda
Node runtime image _does_ ship an AWS SDK, but its exact version drifts from
what this package develops/tests against and isn't a documented, versioned
contract. Externalizing risks a `Cannot find module '@aws-sdk/lib-dynamodb'`
(or a subtly-incompatible-version) failure at cold start. Bundling costs
~1.2MB of zip size (see `bundle.mjs` output), a fine trade for a service
this small.

### Lambda runtime

`template.yaml` targets `nodejs24.x` — verified against AWS's [Node.js 24
runtime announcement](https://aws.amazon.com/blogs/compute/node-js-24-runtime-now-available-in-aws-lambda/)
as a current, actively-supported managed runtime (not assumed). If AWS ever
deprecates it, bump `Runtime` in `template.yaml` (and `LAMBDA_NODE_TARGET` in
`infra/bundle.mjs`) to the next available managed `nodejsNN.x` — the bundle
itself is modern, runtime-version-agnostic JS.

### Security notes

- The Function URL is `AuthType: NONE` (publicly reachable) — `handler.mts`
  delegates to `handleRequest`, which validates the bearer token on every
  request (`/credentials*` admin-only, `/telemetry*` telemetry-cred-only).
  This tradeoff is deliberate: `AWS_IAM` auth would require every caller to
  sign requests with AWS credentials, defeating the point of a portable
  bearer token agents carry in an env var.
- `ReservedConcurrentExecutions: 20` on the function is a DoS backstop for
  the public endpoint — bursts above that ceiling get `429`s rather than
  scaling unbounded. Raise it in `template.yaml` if you expect more
  concurrent traffic. **Deploy prerequisite**: this reserves 20 units of
  your account's concurrency limit (1000 by default on a standard account);
  on a new/restricted account with little unreserved headroom left, the
  deploy can fail on this specifically — lower it, or request a limit
  increase, if that happens.
- The IAM role is scoped to exactly the DynamoDB actions the handler issues
  against the one table (`GetItem`/`PutItem`/`Query`/`UpdateItem`/
  `DeleteItem`) plus `CloudWatch Logs` write access to its own log group —
  nothing broader.
