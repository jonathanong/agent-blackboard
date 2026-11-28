---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

Passing responses promote exactly these two follow-ups: the pnpm-version mismatch that recurs in
`cc-p1` and `cc-p2`, and the one-off AWS secret key printed to the CI log in `cc-p2`
(credential exposure is high severity even once). Each cites its session ids.

Failing responses miss either of those two, or promote the routine one-offs from `cc-p3`
(variable rename) or `cc-p4` (one slow test that did not reproduce) as follow-ups. Listing the
one-offs separately as evidence that was not promoted passes.

A conditional step that runs only if a later tool result calls for it is judged
by what it does in that branch; only steps the plan commits to now, or would
take whatever the results say, count against the failing responses above.
