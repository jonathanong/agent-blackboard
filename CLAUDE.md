# atel

A telemetry stream for autonomous agents — not a knowledge base. See [README.md](README.md)
for the product description.

## Workspace

- pnpm workspace, Node 24+, all source is `.mts` ESM.
- `packages/atel` — **published** as `@jongleberry/atel` (client lib +
  CLI + MCP server). Must never depend on `packages/server` or `@aws-sdk/*`
  (enforced by `.dependency-cruiser.cjs`).
- `packages/server` — **not published**, deployed only. Lambda + DynamoDB, CloudFormation
  in `packages/server/infra/`.
- `plugins/atel` — Claude Code + Codex plugin (skill + MCP registration).

## Commands

- `pnpm lint` — oxlint, oxfmt, ast-grep, knip, dependency-cruiser (chained).
- `pnpm typecheck` — native `tsc --noEmit`.
- `pnpm test:coverage` — vitest + v8 coverage; 100% required (project + patch, see `codecov.yml`).
- `pnpm run actionlint` — lints `.github/workflows/*.yml`.
- `pnpm run lint:links` — checks links in `**/*.md`/`**/*.json` via `lychee` (`lychee.toml`).
  `lychee` isn't an npm package — install it separately (`brew install lychee`, `cargo install
lychee`, or a GitHub release binary) to run this locally; CI installs it via `lycheeverse/lychee-action`.
- `packages/server`: `pnpm run dev` (local server), `pnpm run deploy` (CloudFormation via AWS CLI).
- Running the CLI locally, before it's ever published: `pnpm run build` then `pnpm exec
atel <args>` from anywhere in the repo. This works because the root `package.json`
  lists `@jongleberry/atel` as a `workspace:*` devDependency purely to get pnpm to
  link its bin into root's `node_modules/.bin` (a workspace package's own `bin` field is never
  self-linked into its own `node_modules/.bin` otherwise — that only happens for actual
  dependencies). Ignored in `knip.jsonc` since it's never imported, only linked for its bin.

## Conventions

- Prefer `pnpm` over `npm`.
- Max 200 lines per non-test source file (`.oxlintrc.json`).
- Every dependency bump: check latest version (LTS if one exists) before adding.
- Token formats: telemetry `atl_sk_<credId>_<secret>`; admin `atl_admin_<name>_<secret>` — never
  confuse the two. Admin credentials live only in the `ATEL_ADMIN_CREDENTIALS` env var, never in
  DynamoDB. Credential management (`/credentials*`) is CLI/admin-only, never exposed over MCP.
- `data` on a telemetry entry is intentionally unstructured JSON — don't impose a schema; let
  agents decide what to attach (branch names, PR numbers, etc.) and filter client-side.
- Runtime-only modules that can't be exercised by vitest directly (e.g. `handler.mts`'s use of
  the Lambda-only `awslambda.streamifyResponse` global) should stay a thin wrapper over tested
  logic, with any necessary coverage exclusion justified inline.

## Testing

- Unit tests use the in-memory store (`packages/server/src/store/memory.mts`).
- Integration tests exercise the real DynamoDB store against **DynamoDB Local**; they skip
  gracefully when no local endpoint is configured, and CI runs them via a service container.
- [`docs/smoke-test.md`](docs/smoke-test.md) is a prompt for a real agent (not an automated
  test) that exercises session-lifecycle behavior automated tests can't observe — a real
  `/clear`-equivalent boundary and subagent session attribution. Dispatch it after any change
  to session resolution, hooks, or the Codex/Claude Code plugin manifests.

## Dogfooding

Agents working on this repo should record real friction, decisions, findings, and changes using
`atel` itself as they go (`telemetry_append` via MCP, or `atel append` via the
CLI against a local server — `ATEL_STORE=memory pnpm run dev`, no AWS account needed) —
not placeholder text, actual findings from the session. Log changes as you make them, not
just impressions after the fact: a non-trivial edit, a file added or removed, a bug fixed — the
concrete "what changed" is what a later retrospective/distill pass needs, not a vague summary.
This is the same practice `plugins/atel/skills/atel/SKILL.md` and
[`docs/loop-engineering.md`](docs/loop-engineering.md) describe for downstream users; there's
no reason this repo shouldn't use its own tool.

Dogfood the full loop, not just the write side: run `/retrospective` at the end of a substantial
session to synthesize what was recorded (and what wasn't, from your own memory of the session)
into one durable entry, and periodically run `/retrospective-distill` across accumulated
retrospectives to turn recurring themes into concrete follow-ups (a CLAUDE.md edit, a GitHub
issue, a lint rule). See
[`.claude/skills/retrospective/SKILL.md`](.claude/skills/retrospective/SKILL.md) and
[`.claude/skills/retrospective-distill/SKILL.md`](.claude/skills/retrospective-distill/SKILL.md)
— both are symlinked at `.agent/skills/` too, so Codex can discover them the same way.
