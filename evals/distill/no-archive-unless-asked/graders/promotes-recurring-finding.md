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

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
