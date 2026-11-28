# Evals

Two suites measure whether the plugin changes what an agent does with agent-blackboard. The
plugin has two skills, `agent-blackboard` (create sessions and write entries) and `distill` (turn
snapshots into follow-ups), and an MCP server.

- **The live suite** (`evals/live/`) runs the plugin as a user installs it, skills and real MCP
  server, against an agent that has only the `agent-blackboard` CLI. Each attempt gets its own
  blackboard, seeded by the case, and the graders read the server's end state. It answers: does
  installing the plugin make the agent leave the blackboard in the right state?
- **The plan-only suite** (`evals/<skill>/`) compares the skills on and off. The MCP server runs in
  neither arm. Both arms get the same plain-text list of its tools in the system prompt, and the
  agent writes out the calls it would make. It answers: does the skill make the agent follow a
  rule it would otherwise break?
- **The journaling suite** ([`evals/journaling/`](journaling/README.md)) measures the separate
  `agent-journaling` plugin, skills on and off, with its own scores, rules, and run log.

## Live suite: plugin vs. CLI only

Run of 2026-11-28 at commit `f8464c6`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge Opus
(three votes per grader). Three attempts per arm, eight for `friction-misleading-error`. Cost
$6.06: $3.52 for the agent and $2.54 for the judges, about $0.13 per attempt.

<!-- eval-live-table:start -->

| Case                                                    | Priority | With plugin          | CLI only             | Loaded | Verdict       |
| ------------------------------------------------------- | -------- | -------------------- | -------------------- | ------ | ------------- |
| `live/agent-blackboard/friction-misleading-error`       | medium   | 100 [68-100], 8 of 8 | 50 [22-78], 4 of 8   | 0 of 8 | met           |
| `live/agent-blackboard/patch-failed-no-append`          | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `live/agent-blackboard/repo-tags-cli-named`             | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `live/agent-blackboard/repo-tags-patch-before-append`   | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `live/agent-blackboard/subagent-sessions-direct-parent` | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `live/distill/no-archive-unless-asked`                  | critical | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |

<!-- eval-live-table:end -->

"With plugin" attempts have the skills and the MCP server; "CLI only" attempts have neither and
find the CLI on PATH. "Loaded" counts with-plugin attempts that called the skill. "Ceiling" means
every CLI-only attempt passed.

### What each live case checks

- `repo-tags-patch-before-append`: the session's repositories end as the sorted, lowercase union,
  patched before the finding is appended to it.
- `repo-tags-cli-named`: the same case with the CLI named in the system prompt, as a CLI user's
  `AGENTS.md` would.
- `patch-failed-no-append`: the session is archived, so its tags cannot change. The finding must go
  to a new session tagged with the repository, not the archived one.
- `subagent-sessions-direct-parent`: three worker sessions exist, and the nested helper's parent is
  the worker that dispatched it.
- `friction-misleading-error`: a task with a misleading error and no mention of the blackboard in
  the prompt. The agent should record the friction with concrete evidence.
- `distill/no-archive-unless-asked`: a "what should we fix" sweep leaves every session unarchived and
  reports the finding that recurs in two sessions.

### How to read the live numbers

- **Four cases separate the arms.** CLI-only agents appended to the archived session (0 of 3),
  appended with a mixed-case repository and never patched the union (0 of 3 in both repo-tags
  cases), and recorded the friction in only 4 of 8 attempts (see the next two bullets). With the plugin, all of
  these passed.
- **Read the friction gap as discoverability, and as partly a harness artifact.** Of the four
  CLI-only failures, two never looked for a CLI. The other two ran `which agent-blackboard`, which,
  unlike bash, does not expand the literal `~/.local/bin` entry the harness puts on PATH, so they
  concluded the CLI was missing. In the first live run, with the CLI named in the prompt, CLI-only
  agents recorded the friction 8 of 8. The plugin's gain here is that its tools need no
  instructions; a CLI user whose `AGENTS.md` names the CLI would likely not see it.
- **The friction gain comes from the MCP tools, not the skill.** The skill loaded in 0 of 8
  attempts, yet every attempt recorded the friction through the MCP tools. The four CLI-only
  failures made no blackboard write at all. Adding "friction" to the skill's description did not
  change loading (0 of 8 again, `HISTORY.md`), so it was reverted.
- **Naming the CLI changes which tools the plugin agent uses.** With the CLI named in the system
  prompt, with-plugin agents used only the CLI and lost the repository union in 3 of 3 attempts:
  they patched `repositories` to just the new repository. The skill now says to read the session's
  tags before merging; `repo-tags-cli-named` then passed 3 of 3. Without the CLI named, the
  plugin agents used the MCP tools, whose `session_ensure` returns the existing tags.
- **Two cases are at the ceiling.** `subagent-sessions-direct-parent` and `no-archive-unless-asked`
  pass with the CLI alone.
- **Every sandboxed Bash call reports exit code 1.** The eval sandbox cannot write Bash's
  working-directory file, so each call appends a "Read-only file system" line. Both arms see it,
  and the agents noted it and carried on.
- **Three attempts are small.** 3 of 3 has a 95% lower bound of 44%.

## Plan-only suite: skills on vs. off

Run of 2026-11-28 at commit `ecfc9aa`, Claude Code 2.1.332. Agent `claude-sonnet-5-5`, judge
Opus (three votes per grader). Three attempts per arm. Cost $10.24: $2.88 for the agent and $7.36
for the judges, about $0.19 per attempt. All 9 cases met their targets: critical 1 of 1, high 6 of
6, medium 2 of 2.

Two later runs replaced rows' with-skill results. `patch-failed-no-append` was re-measured at
`8e60c5f` after its grader was clarified ($0.72). The four `agent-blackboard` cases' with-skill arm
was re-measured at `f8464c6` after the skill's repository paragraph changed ($1.90); their
"Without" column is still from `ecfc9aa`, since the baseline does not see the skill.

<!-- eval-table:start -->

| Case                                               | Priority | With skill           | Without              | Loaded | Verdict       |
| -------------------------------------------------- | -------- | -------------------- | -------------------- | ------ | ------------- |
| `agent-blackboard/correction-appends-new-entry`    | medium   | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `agent-blackboard/patch-failed-no-append`          | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `agent-blackboard/repo-tags-patch-before-append`   | high     | 100 [44-100], 3 of 3 | 0 [0-56], 0 of 3     | 3 of 3 | met           |
| `agent-blackboard/subagent-sessions-direct-parent` | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/archive-skips-changed-session`            | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/cleanup-on-empty-export`                  | high     | 100 [44-100], 3 of 3 | 67 [21-94], 2 of 3   | 3 of 3 | met           |
| `distill/no-archive-unless-asked`                  | critical | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/promotion-threshold`                      | medium   | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |
| `distill/repo-sweep-keeps-shared-session`          | high     | 100 [44-100], 3 of 3 | 100 [44-100], 3 of 3 | 3 of 3 | met (ceiling) |

<!-- eval-table:end -->

Each rate is a percentage, the Wilson 95% interval, and the count. "Loaded" is how many
with-skill attempts called the skill. A row marked "ceiling" passed every baseline attempt. It
shows that the skill does no harm, not that it helps.

### What each plan-only case checks

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

### How to read the plan-only numbers

- **Only two cases separate the arms.** On `repo-tags-patch-before-append` and
  `patch-failed-no-append`, the baseline went 0 of 3 and the skill 3 of 3. Without the skill,
  the agent appended an entry with `repository: "JongleBerry/PR-Shepherd"` and never patched the
  session's repositories. On the archived session, it appended the finding to that session
  anyway.
- **`cleanup-on-empty-export` without the skill, 2 of 3, is noise.** The one failure was a split
  judge vote (2 to 1) on a branch that skips cleanup if a re-check contradicts the empty export.
  Treat the row as a ceiling case.
- **The other six are ceiling cases, and the `distill` skill is unmeasured on Sonnet.**
  Sonnet follows these rules from the tool list and the prompt alone. The rows are loading and
  no-harm checks only, not evidence that the skills help. Three more distill cases were piloted
  and also passed without the skill (see `HISTORY.md`). Measuring `distill` needs a weaker agent
  model or harder cases.
- **The `snapshot_cleanup` fix made the skill unnecessary for cleanup.** In the one-attempt
  pilot, under the old `snapshot_cleanup` description, the baseline called it with only the
  token (0 of 1), and the real handler rejects that call. The description now says a path or
  directory is required. The fix went into the tool schema every agent sees, so the skill no
  longer makes the difference.
- **Three attempts are small.** 3 of 3 has a 95% lower bound of 44%, so a case that passes about
  half the time could still show 3 of 3. A gap of 3 of 3 against 0 of 3 is the smallest gap this
  sample can show clearly.

## What the suite does not measure

- **A real server.** The live suite's server is the real request handler and in-memory store,
  run by `evals/live/harness/`. It does not cover DynamoDB, the hosted Lambda, auth beyond one
  credential, or network failures and the outbox.
- **Loading on a cold request, beyond one case.** Only `friction-misleading-error` leaves the
  blackboard out of the prompt; every other prompt is about it. Three attempts are too few to
  quote a loading rate for those.
- **Distill's snapshot files.** No live case checks that snapshot and partition files are cleaned
  up; the plan-only `cleanup-on-empty-export` covers the call.
- **Other models.** The agent is Sonnet only. A rule at the ceiling on Sonnet may still matter
  for a weaker model.
- **The repository's own `.agent/skills`** (`blackboard`, `retrospective`,
  `retrospective-distill`). They are not part of the plugin and are not tested.

## How to run it

Both suites run outside Claude Code's sandbox and need a Claude login. Raw results go to
`evals/results/` (git-ignored).

- `pnpm run evals:live` runs the live suite: 6 cases × 2 arms, 3 attempts (8 for the friction
  case), about $6. It starts the harness server on `127.0.0.1:47811` (`EVAL_HARNESS_PORT`). Then
  `pnpm run evals:summary evals/results/live-latest.json`.
- `pnpm run evals` runs the plan-only suite: 9 cases × 2 arms × 3 attempts, about $10, and stops
  at `EVAL_MAX_COST_USD` (default $40). Then `pnpm run evals:summary`.

See [HISTORY.md](HISTORY.md) for every run and [AGENTS.md](AGENTS.md) for the rules on changing
cases.
