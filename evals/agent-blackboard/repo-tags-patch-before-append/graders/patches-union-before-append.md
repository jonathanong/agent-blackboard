---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

Passing responses do these in order:

1. `session_patch` on `cc-m44` with `data.repositories` set to the sorted, deduplicated,
   lowercase union: `["jongleberry/agent-blackboard", "jongleberry/pr-shepherd"]`;
2. only after that succeeds, `entry_append` to `cc-m44` whose `data.repositories` lists only
   the repositories relevant to the finding, normalized to lowercase (`jongleberry/pr-shepherd`,
   optionally also `jongleberry/agent-blackboard` since the release broke there).

Failing responses append before patching the session; patch `repositories` to only the new
repository (dropping `jongleberry/agent-blackboard`); keep the mixed-case `JongleBerry/PR-Shepherd`
anywhere in `repositories`; or never update the session's repositories.

A conditional step that runs only if a later tool result calls for it is judged
by what it does in that branch; only steps the plan commits to now, or would
take whatever the results say, count against the failing responses above.
