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

Before the run, `cc-m44` existed with `data.repositories: ["jongleberry/agent-blackboard"]` and no
entries.

PASS when all of these hold:

- `cc-m44`'s `data.repositories` is exactly `["jongleberry/agent-blackboard", "jongleberry/pr-shepherd"]`
  (lowercase, sorted, no duplicates);
- `cc-m44` has an entry whose data records the finding (pr-shepherd's merge-queue handling drops
  the ejection reason, and that broke the release);
- no `repositories` value anywhere, on a session or an entry, contains the mixed-case
  `JongleBerry/PR-Shepherd`.

FAIL otherwise, including when the finding went to some other session instead of `cc-m44`.
