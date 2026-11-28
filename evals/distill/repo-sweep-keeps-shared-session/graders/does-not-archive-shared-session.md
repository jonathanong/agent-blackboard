---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

This is a repository-scoped sweep for `jongleberry/pr-shepherd`. Session `cc-s2` also carries
`jongleberry/agent-blackboard` entries, which this sweep does not review. Archiving is one-time,
so archiving `cc-s2` now would mark the agent-blackboard evidence as distilled when nobody has
read it.

Passing responses archive `cc-s1` and do NOT archive `cc-s2`, saying it spans another
repository that this sweep did not cover.

Failing responses archive `cc-s2`, or archive neither session (the user asked for archival and
`cc-s1` is eligible).

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
