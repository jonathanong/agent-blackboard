# Journaling evals

This suite measures whether the `agent-journaling` plugin makes an agent journal friction to
agent-blackboard when it happens, without being asked: a red CI run, a test that fails for no
clear reason, a setup that does not work as documented, ambiguous code, a tool that needed a
workaround, a correction, a slow test run, or lost context. It also checks how the entry is
written: the registered schema, recommendations that name a location, references to earlier
entries, and no secrets. Every case is plan-only and runs with the plugin's skills on and off. The
difference between the arms is the result.

## Current results

Run of 2026-11-28 at commit `e349bb1`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge Opus
(three votes per grader). Three attempts per arm. Cost $20.85: $4.94 for the agent and $15.91 for
the judges. Two rows come from a re-measure at `90f7653` with six attempts per arm, after a
description change: `journal-dev-setup/missing-database-step` ($4.53) and
`journal-tool-friction/sandbox-cache-denied` ($3.56).

<!-- eval-table:start -->

| Case                                                          | Priority | With skill           | Without              | Loaded | Verdict       |
| ------------------------------------------------------------- | -------- | -------------------- | -------------------- | ------ | ------------- |
| `journaling/journal-ambiguity/readme-contradicts-code`        | medium   | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-ci-failure/lockfile-ci-red`               | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-correction/wrong-package-manager`         | medium   | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-dev-setup/missing-database-step`          | high     | 100 [61-100], 6 of 6 | 0 [0-39], 0 of 6     | 6 of 6 | met           |
| `journaling/journal-lost-context/resume-without-notes`        | low      | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-recall/reuse-known-fix`                   | medium   | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `journaling/journal-recall/search-before-debugging`           | medium   | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-slow-loop/slow-full-suite`                | low      | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-tool-friction/sandbox-cache-denied`       | medium   | 100 [61-100], 6 of 6 | 0 [0-39], 0 of 6     | 6 of 6 | met           |
| `journaling/journal-unclear-failure/ci-only-date-test`        | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `journaling/journal-unclear-failure/no-journal-for-red-green` | medium   | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 0 of 3 | met (ceiling) |
| `journaling/journal/redacts-secret`                           | critical | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 2 of 3 | met           |
| `journaling/journal/uses-registered-schema`                   | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |

<!-- eval-table:end -->

## What each case checks

- `journal-ci-failure/lockfile-ci-red`: given a red CI log, the agent journals the check, run,
  error, and cause, and recommends where to stop the failure recurring.
- `journal-unclear-failure/ci-only-date-test`: given a test that fails only in CI, it journals
  the failure and recommends what would make the cause obvious, with a location.
- `journal-unclear-failure/no-journal-for-red-green`: it does not journal a test it wrote to fail
  first. The baseline passes this by default; it guards against over-triggering.
- `journal-dev-setup/missing-database-step`: when the README's setup fails, it journals the
  command, error, and fix, and recommends a docs or script change.
- `journal-ambiguity/readme-contradicts-code`: when the README and the code disagree, it journals
  both sources, its reading, and how to remove the doubt.
- `journal-tool-friction/sandbox-cache-denied`: after an earlier sandbox denial and workaround,
  it journals both before it wraps up.
- `journal-correction/wrong-package-manager`: after the user corrects it, it journals the
  assumption and recommends the rule that would have prevented it.
- `journal-slow-loop/slow-full-suite`: after a 14-minute test run, it journals the duration and
  the faster command.
- `journal-lost-context/resume-without-notes`: after taking over a branch with no notes, it
  journals what was missing.
- `journal-recall/search-before-debugging`: before debugging a CI failure, it searches earlier
  journals for the repository, without changing other sessions.
- `journal-recall/reuse-known-fix`: given an earlier matching entry, it tries the recorded fix
  and links the earlier entry in its own.
- `journal/uses-registered-schema`: it appends with the registered, non-deprecated schema and
  data that fits it.
- `journal/redacts-secret`: it journals a failure whose log has a token without copying the
  token.

## How to read the numbers

Every case passed every with-skill attempt. The baseline failed ten of thirteen: left alone,
Sonnet journals friction only now and then, and when it does, it writes a one-line summary with no
recommendation and no location. Three rows are ceiling cases. `reuse-known-fix` hands the agent a
matching earlier entry, and the baseline uses it. `uses-registered-schema` asks for the entry and
lists the schemas, and the baseline picks the right one. `no-journal-for-red-green` is a guard
against over-triggering, which the baseline passes by default. They show that the skills fire
and do no harm there, not that they help.

Three attempts per arm cannot tell 70% from 100%; read a row as "does the skill change the
outcome", not as a rate. A loading rate needs six or more attempts. "Loaded" counts attempts
that called the case's skill: in a trigger case the agent also loads `journal`, which is not
counted. In `no-journal-for-red-green`, loading is not a target.

## What it does not measure

- Whether entries reach a server: the cases are plan-only, and the agent writes the calls.
- Real sessions, where friction is spread over hours and competes with the task for attention.
  A plan-only case puts the friction in front of the agent.
- The agent-blackboard plugin's own rules, such as merging repository tags; the suite in
  `evals/` covers those.

## How to run it

`pnpm run evals:journaling` outside the sandbox; see [`AGENTS.md`](AGENTS.md). Raw results land
in `evals/results/journaling-*`, which git ignores. The run log is
[`HISTORY.md`](HISTORY.md).
