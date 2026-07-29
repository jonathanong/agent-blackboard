# agent-blackboard

A session-scoped entry stream for autonomous agents — not a knowledge base. See [README.md](README.md)
for the product description.

## Workspace

- pnpm workspace, Node 24+, all source is `.mts` ESM.
- `packages/agent-blackboard` — **published** as `agent-blackboard` (client lib +
  CLI + MCP server). Must never depend on `packages/server` or `@aws-sdk/*`
  (enforced by `.dependency-cruiser.cjs`).
- `packages/server` — **not published**, deployed only. Lambda + DynamoDB, CloudFormation
  in `packages/server/infra/`.
- `plugins/agent-blackboard` — Claude Code + Codex plugin (skill + MCP registration).

## Commands

- `pnpm lint` — oxlint, oxfmt, knip, dependency-cruiser (chained).
- `pnpm typecheck` — native `tsc --noEmit`.
- `pnpm test:coverage` — vitest + v8 coverage; 100% required (project + patch, see `codecov.yml`).
- `pnpm run actionlint` — lints `.github/workflows/*.yml`.
- `pnpm run lint:links` — checks links in `**/*.md`/`**/*.json` via `lychee` (`lychee.toml`).
  `lychee` isn't an npm package — install it separately (`brew install lychee`, `cargo install
lychee`, or a GitHub release binary) to run this locally; CI installs it via `lycheeverse/lychee-action`.
- `packages/server`: `pnpm run dev` (local server), `pnpm run deploy` (CloudFormation via AWS CLI).
- Running the CLI locally, before it's ever published: `pnpm run build` then `pnpm exec
agent-blackboard <args>` from anywhere in the repo. This works because the root `package.json`
  lists `agent-blackboard` as a `workspace:*` devDependency purely to get pnpm to
  link its bin into root's `node_modules/.bin` (a workspace package's own `bin` field is never
  self-linked into its own `node_modules/.bin` otherwise — that only happens for actual
  dependencies). Ignored in `knip.jsonc` since it's never imported, only linked for its bin.

## Conventions

- Prefer `pnpm` over `npm`.
- Max 200 lines per non-test source file (`.oxlintrc.json`).
- Every dependency bump: check latest version (LTS if one exists) before adding.
- Token formats: client `abb_sk_<credId>_<secret>`; admin `abb_admin_<name>_<secret>` — never
  confuse the two. Admin credentials live only in the `AGENT_BLACKBOARD_ADMIN_CREDENTIALS` env var, never in
  DynamoDB. Credential management (`/credentials*`) is CLI/admin-only, never exposed over MCP.
- Session ids are always supplied by the caller. Never infer them from host environment variables,
  state files, or process context, and never generate session or entry ids. The server may generate
  timestamps only. Session ids use URL-safe letters, numbers, `.`, `_`, `:`, and `-`.
- Sessions are first-class records. A root session has `parentSessionId: null`; every subagent
  creates its own session with its direct parent's id. Parent links are immutable, must reference
  an existing session owned by the same credential, whether archived or not. Every session requires caller-supplied
  `agent` and `version`. Session `data` is unstructured JSON and patches shallow-merge it.
- One DynamoDB table stores multiple item types, never nested entry arrays: session metadata is one
  item and each entry is its own item. An entry is identified by `(sessionId, createdAt)`; archival
  belongs to the session metadata item as `archivedAt`, not individual entries. Archival means the
  session was distilled exactly once: metadata patches and further retrospectives fail, while
  entries remain appendable and children may still reference the archived parent. Every entry's
  DynamoDB TTL is based on its own `createdAt`; session metadata never expires.
- `data` on an entry is intentionally unstructured JSON — don't impose a schema; let
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
  to session contracts or the Codex/Claude Code plugin manifests.

## Dogfooding

Agents working on this repo should record real friction, decisions, findings, and changes using
the [`blackboard`](.agent/skills/blackboard/SKILL.md) skill as they go (`entry_append` via MCP, or
`agent-blackboard append` via the CLI against a local server —
`AGENT_BLACKBOARD_STORE=memory pnpm run dev`, no AWS account needed). Log actual learnings,
findings, and gotchas with concrete evidence, not placeholder text or vague progress narration.
This is the same practice `plugins/agent-blackboard/skills/agent-blackboard/SKILL.md` and
[`docs/loop-engineering.md`](docs/loop-engineering.md) describe for downstream users; there's
no reason this repo shouldn't use its own tool.

Dogfood the full loop, not just the write side: run `/retrospective` at the end of a substantial
session to make its last append a thorough synthesis, and periodically run
`/retrospective-distill` across accumulated blackboard evidence to turn it into concrete follow-ups
(a CLAUDE.md edit, a GitHub issue, a lint rule). See
[`.agent/skills/blackboard/SKILL.md`](.agent/skills/blackboard/SKILL.md),
[`.agent/skills/retrospective/SKILL.md`](.agent/skills/retrospective/SKILL.md) and
[`.agent/skills/retrospective-distill/SKILL.md`](.agent/skills/retrospective-distill/SKILL.md).
`.agent/skills/` is canonical; `.claude/skills` is a symlink to it for Claude Code discovery.
