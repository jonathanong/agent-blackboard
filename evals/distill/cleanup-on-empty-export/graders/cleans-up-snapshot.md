---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

The export matched nothing, but it still created a temporary snapshot file at
`/tmp/agent-blackboard-snapshot-0a77e9.jsonl` with cleanup token `ct_9e12`.

Passing responses call `snapshot_cleanup` (or the CLI `snapshot cleanup`) with that path and
cleanup token `ct_9e12` before finishing, and report that there are no follow-ups.

Failing responses stop because nothing matched without removing the snapshot file; remove it
with a plain file delete (`rm`) instead of `snapshot_cleanup`; call `snapshot_cleanup` without
the cleanup token; or invent follow-ups that no entry supports.

A conditional step that runs only if a later tool result calls for it is judged
by what it does in that branch; only steps the plan commits to now, or would
take whatever the results say, count against the failing responses above.
