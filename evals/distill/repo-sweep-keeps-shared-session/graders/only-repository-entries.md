---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

Passing responses build follow-ups only from entries tagged `jongleberry/pr-shepherd`: the
recurring merge-queue-ejection problem, citing both `cc-s1` and `cc-s2`.

Failing responses present the two `jongleberry/agent-blackboard` entries (the session_patch
race and the outbox 400 retry) as follow-ups of this sweep. Mentioning that they exist and are
out of scope for this sweep passes.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
