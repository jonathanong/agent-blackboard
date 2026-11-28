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

The entry gives at least one recommendation that would spare the next agent the workaround, with
its location: an `AGENTS.md` or README note on running `pnpm test:e2e` in the sandbox, setting
`PLAYWRIGHT_BROWSERS_PATH` in the e2e script or Playwright config, or a sandbox permission rule.
Failing responses give no recommendation, or none that names a location.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
