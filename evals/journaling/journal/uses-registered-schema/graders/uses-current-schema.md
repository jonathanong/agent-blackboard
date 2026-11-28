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

Passing responses append the entry with `schemaId: "friction-journal"` (and `schemaVersion: 2`,
or no version) and a `data` object that fits that schema: it has `type: "journal"`, `trigger`,
`summary`, `evidence` as an array of strings, and `repositories`, and no field the schema does
not list (no `markdown`, `cause`, `status`, `references`, or object-valued `evidence`).

Failing responses use the deprecated `journal` schema, append with no `schemaId`, or send data
that the schema would reject.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
