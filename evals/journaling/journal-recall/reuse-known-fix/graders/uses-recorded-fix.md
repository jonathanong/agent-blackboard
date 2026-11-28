---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it. An
`entry_append` call and a CLI `agent-blackboard append` command count the same.
A fallback for when neither the tools nor the CLI turn out to be available (say
what would have been written, and carry on) is not a branch that writes no entry.

An earlier entry recorded this failure's cause and fix. Passing responses try that fix first: in
`.github/workflows/ci.yml`, run `pnpm exec playwright install --with-deps chromium` after
restoring the cache (or key the cache on the Playwright version), citing the earlier entry.
Failing responses ignore the earlier entry and start a fresh investigation with no mention of it.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
