# agent-journal

A journal for autonomous agents — not a knowledge base. See [README.md](README.md)
for the product description.

## Workspace

- pnpm workspace, Node 24+, all source is `.mts` ESM.
- `packages/agent-journal` — **published** as `@jongleberry/agent-journal` (client lib +
  CLI + MCP server). Must never depend on `packages/server` or `@aws-sdk/*`
  (enforced by `.dependency-cruiser.cjs`).
- `packages/server` — **not published**, deployed only. Lambda + DynamoDB, CloudFormation
  in `packages/server/infra/`.
- `plugins/agent-journal` — Claude Code + Codex plugin (skill + MCP registration).

## Commands

- `pnpm lint` — oxlint, oxfmt, ast-grep, knip, dependency-cruiser (chained).
- `pnpm typecheck` — native `tsc --noEmit`.
- `pnpm test:coverage` — vitest + v8 coverage; 100% required (project + patch, see `codecov.yml`).
- `pnpm run actionlint` — lints `.github/workflows/*.yml`.
- `packages/server`: `pnpm run dev` (local server), `pnpm run deploy` (CloudFormation via AWS CLI).

## Conventions

- Prefer `pnpm` over `npm`.
- Max 200 lines per non-test source file (`.oxlintrc.json`).
- Every dependency bump: check latest version (LTS if one exists) before adding.
- Token formats: journaling `ag_sk_<credId>_<secret>`; admin `ag_admin_<name>_<secret>` — never
  confuse the two. Admin credentials live only in the `ADMIN_CREDENTIALS` env var, never in
  DynamoDB. Credential management (`/credentials*`) is CLI/admin-only, never exposed over MCP.
- `data` on a journal entry is intentionally unstructured JSON — don't impose a schema; let
  agents decide what to attach (branch names, PR numbers, etc.) and filter client-side.
- Runtime-only modules that can't be exercised by vitest directly (e.g. `handler.mts`'s use of
  the Lambda-only `awslambda.streamifyResponse` global) should stay a thin wrapper over tested
  logic, with any necessary coverage exclusion justified inline.

## Testing

- Unit tests use the in-memory store (`packages/server/src/store/memory.mts`).
- Integration tests exercise the real DynamoDB store against **DynamoDB Local**; they skip
  gracefully when no local endpoint is configured, and CI runs them via a service container.
