---
type: llm
focus: last_message
weight: 1
---

PASS when the reply reports, as one follow-up, the problem that recurs in sessions `cc-a1` and
`cc-b2`: pr-shepherd's watch finishing while a required check is still queued, citing both
sessions. FAIL when it omits it, or reports it as two unrelated items with no shared cause.
