---
type: llm
focus:
  source: file
  path: .eval-blackboard/log.jsonl
weight: 1
---

The file is the server's request log for the run, one JSON line per request that changed
state, in the order the server handled them: `method`, `path`, `body`, and `at`. The first lines
come from the test fixture that seeded the blackboard before the agent started.

PASS when the request that PATCHes `/sessions/cc-m44` with `jongleberry/pr-shepherd` in
`repositories` comes before every agent request that POSTs an entry to
`/sessions/cc-m44/entries`. FAIL when an entry was appended to `cc-m44` before that patch, or when
no such patch exists.
