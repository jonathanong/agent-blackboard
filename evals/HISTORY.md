# Eval history

Newest first. Each entry names the run's commit, models, attempts, and cost.

## 2026-11-28: plan-only `agent-blackboard` cases re-measured after the skill change

- Commit `f8464c6`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge Opus. With-skill arm
  only (`EVAL_ABLATION=none`), 3 attempts. Cost $1.90: $0.68 agent, $1.22 judges.
- The `agent-blackboard` skill's repository paragraph now says to read the session's tags before
  merging (the live entry below). The baseline does not see the skill, so its column stays from
  `ecfc9aa`.
- Result: 3 of 3 on all four `agent-blackboard` cases, as before. No regression.

## 2026-11-28: live suite measured

- Commit `f8464c6`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge Opus. 3 attempts per
  arm, 8 for `friction-misleading-error`. Cost $6.06: $3.52 agent, $2.54 judges.
- The run used the tree that became `f8464c6`, minus two changes that cannot move a score: each
  scaffold now ends with a read so `report.md` always exists, and the live
  `no-archive-unless-asked` is now tagged `priority-critical`, as in the plan-only suite, instead
  of high.
- Suite changes since the first live run below: the system prompt no longer names the CLI; the
  new `repo-tags-cli-named` case keeps that wording; the skill says to read a session's tags
  before merging into them. Rows cannot be compared with the first live run.
- Scores, with plugin against CLI only: `patch-failed-no-append` 3 of 3 vs 0 of 3; both repo-tags
  cases 3 of 3 vs 0 of 3; `friction-misleading-error` 8 of 8 vs 4 of 8;
  `subagent-sessions-direct-parent` and `no-archive-unless-asked` 3 of 3 vs 3 of 3.
- The four CLI-only friction failures made no blackboard write, so the harness had written no
  `report.md` and the grader errored instead of failing. Their traces confirm no write. The
  scaffold change above makes such an attempt a plain FAIL.
- Finding: with the plugin, agents used the MCP tools for every case except
  `repo-tags-cli-named` (CLI only). The skill loaded in 0 of 8 friction attempts, and the MCP tools
  alone were enough to record the friction.

## 2026-11-28: friction loading with "friction" in the skill description

- The same tree as the run above, with the `agent-blackboard` skill description changed to "Use
  when recording progress, decisions, findings, or friction (a misleading error, a workaround, a
  gotcha)". With-plugin arm only, 8 attempts. Cost $1.02: $0.60 agent, $0.42 judges.
- Loading stayed at 0 of 8 against 0 of 8 in the same session's control (the run above). Every
  attempt still recorded the friction through the MCP tools. The description change was
  reverted.

## 2026-11-28: first live run, with the CLI named in the system prompt (superseded)

- Commit `332688b` plus the uncommitted live suite. Same models. 3 attempts per arm, 8 for
  friction. Cost $4.70: $3.02 agent, $1.68 judges.
- The shared system prompt said the `agent-blackboard` CLI was on PATH. With the plugin, agents
  made 0 MCP calls and 43 CLI calls in the five `agent-blackboard` cases; only `distill` used MCP.
- Scores, with plugin against CLI only: `patch-failed-no-append` 3 of 3 vs 0 of 3;
  `repo-tags-patch-before-append` 0 of 3 vs 0 of 3; `friction-misleading-error` 8 of 8 vs 8 of 8
  (loaded 3 of 8); the other two 3 of 3 vs 3 of 3.
- The with-plugin repo-tags failures were real. Each agent loaded the skill, never read the
  session, and patched `repositories` to `["jongleberry/pr-shepherd"]`, dropping
  `jongleberry/agent-blackboard`. The skill said to merge into the cumulative list but not to read
  it first, and its CLI example patches a fresh session with one repository.
- A one-attempt pilot without the CLI named ($0.41) showed the plugin agent using MCP and
  `session_ensure`, which returns the current tags, while the CLI-only agent still found the CLI
  with `which`. The suite switched to that prompt.

## 2026-11-28: live suite built and piloted

- Cost about $2.10: one-attempt pilots of one case ($0.36) and all five cases ($1.30), and about
  $0.50 of probes.
- What the probes found about `claude plugin eval` 2.1.332 on Linux:
  - Sandboxed Bash cannot write anywhere, the workspace included, and every call exits 1 because
    Bash cannot write its working-directory file. File edits go through Write and Edit.
  - Sandboxed Bash cannot reach a host server directly, but it can through the sandbox's proxy
    once `--allow-tools "WebFetch(domain:localhost)"` is granted. Node's `fetch` needs
    `NODE_USE_ENV_PROXY=1` with `NO_PROXY` cleared.
  - Sandboxed Bash can read the plugin root only in the with-plugin arm, so the scaffold copies
    the CLI into the attempt's HOME.
  - A parent Claude Code session's `CLAUDE_TMPDIR` leaks into the attempts and must be unset.
  - A real MCP server starts with the workspace as its working directory.
- Hence the design in `evals/live/harness/`: one host server holds every attempt's state in that
  attempt's workspace, keyed by a token that encodes the workspace path.

## 2026-11-28: `patch-failed-no-append` re-measured after a grader clarification

- Commit `8e60c5f`, same models, 3 attempts per arm. Cost $0.72: $0.29 agent, $0.44 judges.
- The grader asked for "a `parentSessionId`" on the new session without saying what value
  passes. In the run below, with-skill attempt 3 failed it. That attempt started a new root
  session (`parentSessionId: null`), patched it, and appended there, which is what the skill
  says to do. The grader now says `null` or `cc-old-19` both pass. It also says keeping or
  dropping `jongleberry/agent-blackboard` both pass.
- Result: 3 of 3 with the skill, 0 of 3 without. This row in `README.md` comes from this run.

## 2026-11-28: re-run after tightening every grader

- Commit `ecfc9aa`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge Opus. 3 attempts per
  arm. Cost $10.24: $2.88 agent, $7.36 judges.
- Suite changes, in response to review:
  - The shared conditional-step clause now fails a plan when any branch it would take does
    something that fails the grader. Before, only steps the plan committed to counted.
  - `repo-tags-patch-before-append` also requires the appended entry to record the finding.
- None of these rows can be compared with the first measured run below.
- Scores: with the skill, 3 of 3 on every case except `patch-failed-no-append`, which got 2 of 3
  (see the entry above). Without the skill: 0 of 3 on `repo-tags-patch-before-append` and
  `patch-failed-no-append`; 2 of 3 on `cleanup-on-empty-export`, where the one failure was a split
  2–1 judge vote on a branch that skips cleanup; 3 of 3 on the rest.
- Finding: the same two repository-tag cases separate the arms. The distill cases stay at the
  ceiling.

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

- Superseded by the re-run above, after the graders changed.

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
