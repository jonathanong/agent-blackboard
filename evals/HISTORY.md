# Eval history

Newest first. Each entry names the run's commit, models, attempts, and cost.

## 2026-11-28: three distill cases piloted and dropped

- Commit `73e3fcf` plus the uncommitted cases. Claude Code 2.1.332, agent `claude-sonnet-5-5`,
  judge Opus. 1 attempt per arm. Cost $0.67.
- Cases:
  - `archive-rechecks-before-archiving`: archival is requested and no re-read is pasted in.
  - `sweep-from-scratch-export-and-cleanup`: nothing has been run yet.
  - `large-export-partitions`: an export of 140 sessions and 9 MiB.
- Each was meant to catch a rule the existing cases hand to the agent: re-reading `lastEntryAt`
  before archiving, exporting without `path`, and partitioning a large snapshot.
- All three passed 1 of 1 without the plugin. None was kept, since none could show a gap on
  Sonnet. The `distill` skill has no case that separates the arms.

## 2026-11-28: first measured run

- Commit `fbdc666`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge Opus. 3 attempts per
  arm, with and without the plugin.
- Cost $9.71: $2.88 agent, $6.83 judges. That is $0.18 per attempt.
- Scores: every case passed 3 of 3 with the plugin. The baseline went 0 of 3 on
  `agent-blackboard/repo-tags-patch-before-append` and `agent-blackboard/patch-failed-no-append`,
  and 3 of 3 on the other seven, which are ceiling cases.
- Suite changes: first run of all 9 cases. Before it, the `snapshot_cleanup` MCP description was
  changed to say that a path or directory is required. The case system prompt quotes that
  description, so `distill/cleanup-on-empty-export` and the cleanup grader of
  `distill/archive-skips-changed-session` cannot be compared with the pilot below.
- Finding: the skills make a difference only for the repository-tag protocol: patch the
  lowercase union first, and don't append to a session whose patch failed. Sonnet follows the
  distill rules without the skill when it sees the tool list.

## 2026-11-28: failed run, E2BIG on every attempt

- After `pnpm install`, every attempt failed to spawn with `E2BIG: argument list too long`, for $0.
  The plugin root is the repository root, and `claude plugin eval` breaks when `node_modules/` is
  inside it. `scripts/run-evals.sh` now copies `.claude-plugin/`, `plugins/`, and `evals/` cases
  into a temporary directory and evaluates that. Do not point `claude plugin eval` at the
  checkout directly.

## 2026-11-28: pilot, 1 attempt per arm

- Commit `f7cc0bb` plus the uncommitted suite, with the old `snapshot_cleanup` description.
  Claude Code 2.1.332, agent `claude-sonnet-5-5`, judge Opus. Cost $2.67 in total.
- With the plugin, 9 of 9 passed. The baseline failed `repo-tags-patch-before-append`,
  `patch-failed-no-append`, `cleanup-on-empty-export`, and the cleanup grader of
  `archive-skips-changed-session`.
- In the cleanup failures, the baseline called `snapshot_cleanup` with only `cleanupToken`. The
  schema allowed that, but the handler rejects it. That led to the description fix measured
  above.
- An earlier attempt at this pilot ran inside Claude Code's sandbox. Every attempt failed with
  "Not logged in", because the sandbox hides `~/.claude/.credentials.json`. Run the suite outside
  the sandbox.
