---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

Passing responses call `snapshot_cleanup` (or the CLI `snapshot cleanup`) with path
`/tmp/agent-blackboard-snapshot-3c9d10.jsonl` and cleanup token `ct_77b3` before finishing.
Failing responses never remove the snapshot, or remove it with a plain file delete.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
