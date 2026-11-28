# Evals

These evals measure whether the plugin's two skills change what an agent does with
agent-blackboard. `agent-blackboard` covers how to create sessions and write entries. `distill`
covers how to turn snapshots into follow-ups. Each case runs twice: once with the plugin loaded,
and once as a no-plugin baseline. Both arms see the same list of MCP tools. The gap between the
arms answers one question: does the skill make the agent follow a rule it would otherwise break?

## Current results

Run of 2026-11-28 at commit `fbdc666`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge
Opus (three votes per grader). Three attempts per arm. Cost $9.71: $2.88 for the agent and $6.83
for the judges, about $0.18 per attempt. All 9 cases met their targets: critical 1 of 1, high 6
of 6, medium 2 of 2.

<!-- eval-table:start -->

| Case                                               | Priority | With skill           | Without              | Loaded | Verdict       |
| -------------------------------------------------- | -------- | -------------------- | -------------------- | ------ | ------------- |
| `agent-blackboard/correction-appends-new-entry`    | medium   | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `agent-blackboard/patch-failed-no-append`          | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `agent-blackboard/repo-tags-patch-before-append`   | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `agent-blackboard/subagent-sessions-direct-parent` | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/archive-skips-changed-session`            | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/cleanup-on-empty-export`                  | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/no-archive-unless-asked`                  | critical | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/promotion-threshold`                      | medium   | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/repo-sweep-keeps-shared-session`          | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |

<!-- eval-table:end -->

Each rate is a percentage, the Wilson 95% interval, and the count. "Loaded" is how many
with-plugin attempts called the skill. A row marked "ceiling" passed every baseline attempt. It
shows that the skill does no harm, not that it helps.

## What each case checks

**distill**

- `no-archive-unless-asked`: the user asks for follow-ups only, so no session is archived. The
  finding that recurs in two sessions is reported once.
- `cleanup-on-empty-export`: when an export matches zero sessions, the agent still calls
  `snapshot_cleanup` with the token rather than leave the file or `rm` it.
- `archive-skips-changed-session`: when archival is requested, a session whose `lastEntryAt`
  moved after the export is skipped and the unchanged one is archived.
- `repo-sweep-keeps-shared-session`: a repository-scoped sweep does not archive a session that
  also holds another repository's entries, and uses only the swept repository's entries.
- `promotion-threshold`: a finding recurring in two sessions and a one-off credential leak become
  follow-ups. Routine one-offs do not.

**agent-blackboard**

- `subagent-sessions-direct-parent`: each worker gets its own session. A nested helper's parent
  is the worker that dispatched it, not the root.
- `repo-tags-patch-before-append`: the session's repositories are patched to the sorted,
  lowercase union before the tagged entry is appended.
- `patch-failed-no-append`: after the patch fails on an archived session, the finding goes to a
  new session, not the archived one.
- `correction-appends-new-entry`: a wrong entry is corrected by appending a new entry, not by
  editing or patching.

## How to read the numbers

- **Only two cases separate the arms.** On `repo-tags-patch-before-append` and
  `patch-failed-no-append`, the baseline went 0 of 3 and the skill 3 of 3. Without the skill,
  the agent appended an entry with `repository: "JongleBerry/PR-Shepherd"` and never patched the
  session's repositories. On the archived session, it appended the finding to that session
  anyway.
- **The other seven are ceiling cases.** Sonnet follows these rules from the tool list and the
  prompt alone, so the rows show that the skills load and do no harm, not that they help. They
  stay as regression checks for weaker models and harness changes.
- **`cleanup-on-empty-export` was not at the ceiling before this change.** In the one-attempt
  pilot, under the old `snapshot_cleanup` description, the baseline called it with only the
  token (0 of 1). The real handler rejects that call. The description now says a path or
  directory is required, and the baseline passes 3 of 3. The fix went into the tool schema
  every agent sees, so the skill no longer makes the difference. See `HISTORY.md`.
- **Three attempts are small.** 3 of 3 has a 95% lower bound of 44%, so a case that passes about
  half the time could still show 3 of 3. A gap of 3 of 3 against 0 of 3 is the smallest gap this
  sample can show clearly.
- Every row comes from the same run.

## What the suite does not measure

- **Real tool calls.** Every case is plan-only. The MCP server is not started, and the judge
  grades the calls the agent says it would make. A plan that names the right call can still
  fail at runtime, for example on argument types.
- **Loading from a cold request.** Each prompt is about the blackboard. Whether the skill loads
  for a vaguer request is not measured. Three attempts are also too few to quote a loading rate.
- **Other models.** The agent is Sonnet only. A rule at the ceiling on Sonnet may still matter
  for a weaker model.
- **The repository's own `.agent/skills`** (`blackboard`, `retrospective`,
  `retrospective-distill`). They are not part of the plugin and are not tested.

## How to run it

`pnpm run evals`, outside Claude Code's sandbox. It needs a Claude login. It runs 9 cases × 2
arms × 3 attempts with `claude-sonnet-5-5` as the agent and Opus as the judge, and stops at
`EVAL_MAX_COST_USD` (default $40). Raw results go to `evals/results/` (git-ignored). Then run
`pnpm run evals:summary` to update `cases.csv` and the table above.

See [HISTORY.md](HISTORY.md) for every run and [AGENTS.md](AGENTS.md) for the rules on changing
cases.
