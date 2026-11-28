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

The plan's entry, or the plan itself, gives at least one recommendation that would stop this
failure recurring and names where it goes: for example an `AGENTS.md` or contributing note to
commit pnpm-lock.yaml with package.json, a pre-push or lint step that runs `pnpm install
--frozen-lockfile`, or a CI hint. Failing responses give no recommendation, or only a vague one
with no location ("be more careful", "improve docs").

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
