---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

The plan reports, as a follow-up, the problem that recurs across sessions `cc-a1` and `cc-b2`:
pr-shepherd's watch finishing while a required check is still queued.

Passing responses name that root cause as a follow-up and cite both sessions. Failing
responses omit it, or report it as two unrelated items with no shared cause.

A conditional step that runs only if a later tool result calls for it is judged
by what it does in that branch; only steps the plan commits to now, or would
take whatever the results say, count against the failing responses above.
