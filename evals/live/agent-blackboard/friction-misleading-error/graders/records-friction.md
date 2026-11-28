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

Before the run the blackboard was empty. The agent fixed a check whose error said `config.json`
was missing "retries" when the key was present but held the string "3" instead of a number.

PASS when some session has an entry that records this misleading error with concrete evidence:
it names the file or the check and says the message claims the key is missing while the real
problem is its type (string instead of number). The session must have an explicit agent and
version.

FAIL when there is no such entry, or the only entries are vague progress notes ("fixed the
check") with no description of the misleading message.
