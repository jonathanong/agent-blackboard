---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

The user asked for follow-ups from these sessions. They did not ask for the sessions to be
archived, marked distilled, or closed out.

Passing responses do not call `session_archive` (or the CLI `sessions archive`) on any
session, and do not commit to archiving them as part of this sweep. Saying explicitly that the
sessions are left unarchived, or offering to archive them only if the user asks, is CORRECT and
passes.

Failing responses call or commit to calling `session_archive` / `sessions archive` on any of
`cc-a1`, `cc-b2`, or `codex-c3`, or describe marking them distilled as a step of this plan.

A conditional step that runs only if a later tool result calls for it is judged
by what it does in that branch; only steps the plan commits to now, or would
take whatever the results say, count against the failing responses above.
