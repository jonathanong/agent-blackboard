# Agent Blackboard Sentry stack

This independent OpenTofu root owns only the `agent-blackboard-lambda` Sentry
project and its `staging` and `production` client keys. It does not share state,
AWS roles, plans, or apply authorization with Vouchington infrastructure.

The `platform` team, `vouchington` organization, GitHub installation, and
`jonathanong/agent-blackboard` repository connection must already exist in
Sentry. They are referenced but not adopted by this state. After the first
apply, link the project to the already-connected repository in Sentry's project
settings; the provider has no project/repository-link resource.

## Backend and authentication

Supply an encrypted remote S3 backend and DynamoDB lock table at init time. Do
not use the Vouchington backend or its IAM roles.

```sh
tofu -chdir=opentofu/sentry init \
  -backend-config="bucket=$SENTRY_TOFU_STATE_BUCKET" \
  -backend-config="key=agent-blackboard/sentry/terraform.tfstate" \
  -backend-config="region=$AWS_REGION" \
  -backend-config="dynamodb_table=$SENTRY_TOFU_LOCK_TABLE" \
  -backend-config="encrypt=true"
```

Store the least-privilege internal-integration credential outside the
repository as `SENTRY_TOFU_AUTH_TOKEN`, then expose it to the provider for only
the OpenTofu command:

```sh
SENTRY_AUTH_TOKEN="$SENTRY_TOFU_AUTH_TOKEN" \
  tofu -chdir=opentofu/sentry plan -out=agent-blackboard-sentry.tfplan
```

Review the saved plan and record its SHA-256 before requesting explicit
authorization to apply that exact file. A normal application deploy never runs
OpenTofu or applies Sentry changes.

```sh
shasum -a 256 opentofu/sentry/agent-blackboard-sentry.tfplan
SENTRY_AUTH_TOKEN="$SENTRY_TOFU_AUTH_TOKEN" \
  tofu -chdir=opentofu/sentry apply agent-blackboard-sentry.tfplan
```

The state contains provider-returned sensitive key material even though only
the public DSNs are exported. Keep state and saved plans encrypted and private.

## Optional runtime integration

Read the public DSN for the target environment after the Sentry plan is
applied:

```sh
export AGENT_BLACKBOARD_SENTRY_DSN="$(tofu -chdir=opentofu/sentry output -json public_dsns | jq -r '.production')"
pnpm --dir packages/server run deploy -- --sentry=required --sentry-environment=production
```

Omit `--sentry=required` (or pass `--sentry=off`) to deploy without Sentry.
DSNs are public ingestion identifiers; provisioning tokens are never supplied
to the Lambda deployment.
