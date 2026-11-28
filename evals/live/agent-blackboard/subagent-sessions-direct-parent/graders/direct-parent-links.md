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

Before the run only `cc-root-7f2` existed, with no entries.

PASS when there are three new sessions, one each for `worker-api`, `worker-cli`, and
`helper-cli-docs` (recognizable by id, data, or entry content), where:

- the `worker-api` and `worker-cli` sessions have `parentSessionId: "cc-root-7f2"`;
- the `helper-cli-docs` session has `parentSessionId` equal to the `worker-cli` session's id,
  not `cc-root-7f2`;
- each of the three has at least one entry.

FAIL when the workers' entries went into `cc-root-7f2` or a shared session, the helper is
parented on `cc-root-7f2`, or any of the three sessions is missing.
