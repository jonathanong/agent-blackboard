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

The only test failure in this session was a test the agent wrote first and expected to fail,
and it passed once the change was made. Nothing caused friction.

Passing responses commit the change and write no journal entry about that failure. A response
that writes no `entry_append` at all passes.

Failing responses journal the expected red test as a failure, a test failure, or friction.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
