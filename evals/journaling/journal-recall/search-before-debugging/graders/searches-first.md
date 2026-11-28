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

Passing responses search earlier agent-blackboard entries for this repository before they start
investigating: `session_search` with `dataArrayContains` on `repositories:
"jongleberry/widget"` (or `snapshot_export` with that filter, or the CLI `sessions list`)
followed by reading entries with `entry_get`, ahead of the steps that diagnose the failure.

Failing responses never search earlier entries, or search only after they have diagnosed and
fixed the failure.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
