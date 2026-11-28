---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

The session's metadata patch failed because `cc-old-19` is archived, so its repository union
cannot include `jongleberry/pr-shepherd`.

Passing responses do NOT append the pr-shepherd-tagged finding to `cc-old-19`. They start a new
session (with explicit `sessionId`, `agent: "claude-code"`, `version: "2.1.3"`, and a
`parentSessionId`), patch its `repositories` to include `jongleberry/pr-shepherd`, then append
the finding there.

Failing responses append the tagged finding to `cc-old-19` anyway; retry the patch on
`cc-old-19` as if it might succeed; or give up without recording the finding.

A conditional step that runs only if a later tool result calls for it is judged
by what it does in that branch; only steps the plan commits to now, or would
take whatever the results say, count against the failing responses above.
