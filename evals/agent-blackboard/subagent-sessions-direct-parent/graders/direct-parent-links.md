---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.

Passing responses create a separate session for each of `worker-api`, `worker-cli`, and
`helper-cli-docs`, each with an explicit `sessionId`, `agent`, and `version`, where:

- `worker-api` and `worker-cli` have `parentSessionId: "cc-root-7f2"`;
- `helper-cli-docs` has `parentSessionId` set to `worker-cli`'s session id (its direct parent),
  not `cc-root-7f2`.

Each worker then appends to its own session.

Failing responses have the workers write into `cc-root-7f2` or into a shared session; parent the
helper on the root session; omit `sessionId` or `parentSessionId` so the server or harness
picks one; or create no session for the helper.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
