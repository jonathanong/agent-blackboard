---
type: llm
focus: last_message
weight: 1
---

The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it. An
`entry_append` call and a CLI `agent-blackboard append` command count the same.
A fallback for when neither the tools nor the CLI turn out to be available (say
what would have been written, and carry on) is not a branch that writes no entry.

Passing responses commit to an `entry_append` (or `agent-blackboard append`) on session
`cc-eval-1` that records the CI failure. The entry must hold the failing check or job (`build` / `install`), the run (4812) or commit (3f2a91c), the `ERR_PNPM_OUTDATED_LOCKFILE` error, and the cause (package.json changed without a lockfile update). Recording it at the end of the
plan, after the fix, passes too.

Failing responses write no entry, write one only to another session, or write one that is
progress narration ("fixed CI", "tests pass") without the error and its cause.

A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
