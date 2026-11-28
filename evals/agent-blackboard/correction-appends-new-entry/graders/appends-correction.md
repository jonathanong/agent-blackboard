---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

Entries are append-only and cannot be edited or deleted.

Passing responses `entry_append` a new entry to `cc-q8` that states the corrected cause and
points at the earlier entry it corrects (by its `createdAt` `2026-11-28T09:14:02.511Z`, or
plainly as a correction of the earlier entry). Saying the original entry cannot be changed is
CORRECT.

Failing responses try to edit, overwrite, or delete the old entry (for example with
`session_patch` on the session's data, an invented `entry_update`/`entry_delete` tool, or
re-creating the session); or say nothing can be done.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
