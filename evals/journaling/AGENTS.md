# Journaling eval rules

These add to [`../AGENTS.md`](../AGENTS.md). Its rules on runs, models, pilots, controls, graders,
and recording apply here. `README.md` here holds this suite's scores, and `HISTORY.md` its run log.

## Run

```bash
pnpm run evals:journaling                                  # every case, both arms, 3 attempts
pnpm run evals:journaling journal-recall                   # one skill's cases
EVAL_FLAGS='--runs 1' pnpm run evals:journaling            # pilot
EVAL_FLAGS='--case redacts-secret' pnpm run evals:journaling   # one case
pnpm run evals:summary evals/results/journaling-latest.json    # record a run
```

- `scripts/run-evals-journaling.sh` stages `plugins/agent-journaling` on its own, so the
  baseline arm has none of its skills and neither arm has the agent-blackboard plugin.
- Run it outside the sandbox, as for the plan-only suite.

## Cases

- Layout: `evals/journaling/<skill>/<case>/prompt.md` and `graders/*.md`, where `<skill>` is a
  skill in `plugins/agent-journaling/skills/`. Cases are written by `evals/journaling/generate.py`.
  Never edit them by hand; run the generator and `pnpm run oxfmt`.
- Every case is plan-only, with the plan-only suite's system prompt (read from
  `evals/generate.py`) plus the agent's session and any tool results it already has. Put earlier
  tool output and earlier turns of the session in the case's `context`, not in the prompt.
- Write the prompt as the task a person gives. Never say "journal", "blackboard", or "record" in
  a trigger skill's prompt: the case measures whether the friction alone triggers the skill. A
  case for the core `journal` skill may ask for the entry, because it tests how the entry is
  written.
- Tag every case `journaling`, its skill, and a priority. Here, a secret in an entry is critical.
  A missed or empty journal for a trigger the user named is high: nobody notices it is missing.
  A wrong schema, a missed recall, and the triggers the user did not name are medium or low.
- Keep a negative case for each over-triggering risk you add (`no-journal-for-red-green`). Its
  `skill-fired` count is not a target.
- Keep fixtures synthetic: the `jongleberry` owner, made-up ids, no `https://` URLs, no real
  tokens, and no text copied from real journals.

## Graders

- Grade the entry, not the fix: did the plan append on `cc-eval-1`, with the evidence the case
  names, and, where the skill requires them, recommendations that name a location.
- Give each case one grader per rule it tests. Do not also grade the fix, the repository tag
  merge, or rules another case checks.
