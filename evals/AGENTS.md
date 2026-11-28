# Eval rules

Follow the repository root `AGENTS.md` first. `README.md` here holds the current scores for
people, and `HISTORY.md` holds the run log. `cases.csv` holds each case's latest result.

## Run

```bash
pnpm run evals                              # every case, both arms, 3 attempts
pnpm run evals distill                      # one skill's cases (any case tag works)
EVAL_FLAGS='--runs 1' pnpm run evals        # pilot a new case
EVAL_FLAGS='--case promotion-threshold' pnpm run evals   # one case
pnpm run evals:summary                      # write cases.csv and rebuild the README table
pnpm run evals:live                         # the live suite, both arms
EVAL_FLAGS='--runs 1 --case *repo-tags*' pnpm run evals:live   # pilot live cases
pnpm run evals:summary evals/results/live-latest.json         # record a live run
```

- Sonnet (`claude-sonnet-5-5`) is the agent and Opus is the judge. Measure with three attempts
  per arm, the default; quote a loading rate only from six or more attempts of a case.
- Every run has a no-plugin baseline arm (`--ablation with-without`). The difference between
  the arms is the result.
- The run spawns `claude` children that need your login. Claude Code's sandbox hides
  `~/.claude/.credentials.json`, so inside it every attempt fails with "Not logged in"; run it
  outside the sandbox. It does not run in CI.
- Pilot a new case with one attempt and read its traces before measuring it.
- Compare a change against a control measured in the same session, never a stored number.
- Read every failing attempt before changing a case, grader, or skill. Never loosen a grader to
  make a row pass.

## Cases

These rules are for the plan-only suite. The live suite's are in the next section.

- Layout: `evals/<skill>/<case>/prompt.md` and `graders/*.md`. `<skill>` is the plugin skill
  under test (`agent-blackboard` or `distill`).
- Cases are generated. Edit `evals/generate.py`, then run `python3 evals/generate.py` and
  `pnpm run oxfmt`. Never edit a `prompt.md` or grader by hand. To remove a case, delete its
  directory as well as its entry in the generator.
- Every case is plan-only: `allowed_tools: [Read, Glob, Grep, Skill]`, and the agent writes the
  tool calls it would make. Paste earlier tool output into the prompt instead of running it.
- Every case carries the same `append_system_prompt`. It lists the plugin's MCP tools, with
  names and descriptions from `packages/agent-blackboard/src/mcp/schemas*.mts`, so both arms
  see the same tools and the arms differ only in the skills. When a tool is added, renamed, or
  has its description changed, update `SYS` in the generator.
- Tag every case with its skill and a priority: `priority-critical`, `priority-high`,
  `priority-medium`, or `priority-low`.
- Priority is set from impact and how hard the mistake is to catch, using the `evals` skill's
  4×4 matrix. Here, irreversible session archival is critical. Archiving the wrong session or
  losing repository tags is high. Rework is medium. Targets: critical 80%, high 70% (3 of 3),
  medium 60%, low 50% (2 of 3).
- Write prompts the way a person asks. Do not quote the skill's wording or name the skill.
- Build each case on one rule in a skill that the model gets wrong without it. Run the baseline
  arm before keeping a case.
- Keep fixtures synthetic. Use only the `jongleberry` owner and made-up session ids, and no
  real hostnames, tokens, or emails. Do not write `https://` URLs in prompts, because
  `pnpm run lint:links` would check them.

## Live cases

- Layout: `evals/live/<skill>/<case>/case.yaml`, `scaffold.sh`, and `graders/*.md`, written by
  `evals/live/generate.py`. Never edit them by hand; run the generator and `pnpm run oxfmt`.
- Run them only through `scripts/run-evals-live.sh`. It starts `evals/live/harness/harness.mjs` as
  the server, points the staged plugin's MCP server and the `agent-blackboard` on PATH at it,
  unsets `AGENT_BLACKBOARD_URL` and the tokens, and refuses to run if the staged MCP config still
  names `npx` or an `https:` URL. Never pass a live run's `--scaffold`, `--allow-real-servers`, or
  `--allow-tools` flags to any other suite.
- The arms are the installed plugin (skills and MCP server) and no plugin. Both arms have the
  CLI. Do not name the CLI or the MCP tools in the shared system prompt, except in a case built to
  test that wording (`repo-tags-cli-named`).
- Each scaffold seeds its attempt's blackboard with the CLI, which writes nothing outside the
  workspace and the attempt's HOME. Say in the grader which sessions and entries the scaffold
  created.
- Grade the end state: `llm` graders on `.eval-blackboard/report.md` (sessions and entries) or
  `.eval-blackboard/log.jsonl` (the order of writes), with `focus: {source: file, path: ...}`. Add
  a `last_message` grader only for what the agent reports.
- A case that leaves the blackboard out of the prompt measures loading. Run it with eight
  attempts so a loading rate can be quoted.

## Graders

- Every case has `graders/skill-fired.md`, a `tool_used` grader on `Skill`. Anchor its pattern
  with the opening quote (`"(?:[\w-]+:)?distill"`) so `retrospective-distill` does not match.
- Every plan-only case has at least one `llm` grader on `last_message` that checks the outcome.
  State what passes and what fails, and say that a correct refusal passes.
- Grade the rule the case is named for. Do not make a grader also require rules that other cases
  check.
- Do not use a regex over the whole message to check that an action is absent. "I will not call
  session_archive" would match it.

## Actions a case must never perform

- In the plan-only suite, never pass `--mocks off`, `--allow-real-servers`, `--scaffold`, or `--allow-tools`. With the
  default `--mocks record` and no `evals/mocks/`, the plugin's MCP server is not started. Started,
  it would write to whatever `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN` are set.
- Never read or print credentials or dump the environment.

## Recording

- After a measured run, add an entry at the top of `HISTORY.md` with the date, commit, models,
  attempts per arm, and cost, split into agent and judges. Then run `pnpm run evals:summary`.
  It replaces the run's rows in `cases.csv` and rebuilds the table between the `eval-table`
  markers in `README.md`; run `pnpm run oxfmt` after it. Do not edit that table or `cases.csv` by
  hand.
- Changing a case, grader, or tested skill updates `README.md` and `HISTORY.md` in the same pull
  request. A change with no run still gets a `HISTORY.md` entry. Mark the affected rows in
  `README.md` as not re-measured.
- `evals/results/` is git-ignored. `cases.csv`, `README.md`, and `HISTORY.md` are the durable
  record, so update them before you discard the raw results.
