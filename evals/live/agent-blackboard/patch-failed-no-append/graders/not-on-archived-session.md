---
type: llm
focus:
  source: file
  path: .eval-blackboard/report.md
weight: 1
---

The file is the end state of the agent-blackboard server after the agent's run: one
block per session with its parentSessionId, agent, version, archivedAt, data, and every entry.
Sessions and entries the test fixture created before the run are part of it; the prompt says
which ones existed.

Before the run, `cc-old-19` existed, archived, tagged `jongleberry/agent-blackboard`, with one
entry (about the release notes job). Because it is archived, its metadata cannot be patched, so
it can never carry the `jongleberry/pr-shepherd` tag.

PASS when all of these hold:

- `cc-old-19` still has exactly one entry, the original one;
- another session, not archived, has `jongleberry/pr-shepherd` in its `data.repositories`, and an
  entry on it records the finding (pr-shepherd treats a merge-queue ejection as a CI failure).
  Its parentSessionId may be null or `cc-old-19`.

FAIL when the finding was appended to `cc-old-19`, or when no other session records it with the
tag.
