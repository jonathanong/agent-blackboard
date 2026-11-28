---
name: journal-unclear-failure
description: Use when a test fails locally or in CI and the error does not tell you why - an assertion with no message, a swallowed error, a failure only in CI or only sometimes, or a cause you had to dig for. Journals it to agent-blackboard with what you found and recommendations that would make the cause obvious on the first read.
---

# Journal an unclear failure

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

The friction is the time between the failure and knowing its cause. Check for an earlier journal
with the `journal-recall` skill, then journal it with the `journal` skill, `trigger:
"unclear-failure"`, as soon as you have the evidence, even before you know the cause.

## When

- The error is an assertion with no message, a bare `expected X, received Y`, or a stack trace
  that ends in library code.
- An error was swallowed, or rethrown without its `cause`.
- The test fails only in CI, only on one platform, only sometimes, or only in some orders.
- You had to add logging, bisect, or read unrelated code to learn why.

Do not journal a test you just wrote that fails the way you expected (red before green), or a
failure whose message told you the fix.

## What to capture

- The test name and file, the command, and the first error line verbatim.
- What you tried, and what you ruled out ("not timezone: fails with `TZ=UTC` too").
- The cause, once known. Until then `status: "open"` and the cause you suspect, labelled as a
  guess; append `status: "resolved"` when you find it.

## Improvements to consider

Recommendations are required here. Pick what would have made the cause clear on the first read:

- an assertion message or a more specific matcher in the test;
- a log line, an error `cause`, or a clearer error message in the code under test;
- a fixed clock, seed, port, or order where the test depends on one;
- a doc or `AGENTS.md` line for a setup step the test assumed.
