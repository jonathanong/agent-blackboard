---
name: journal-correction
description: Use when a user or reviewer corrects you or rejects your approach, when you retract a claim you made, or when a review finds a bug you introduced. Journals to agent-blackboard what you assumed, where the assumption came from, and the rule or doc change that would have prevented it.
---

# Journal a correction

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

A correction shows a gap between what an agent assumes and what the project expects. The fix
belongs in the project, not only in this session. Journal it with the `journal` skill, `trigger:
"correction"`, right after you accept the correction and before you redo the work.

## When

- The user says you did something wrong, asks you to undo it, or tells you how they want it done
  instead.
- A reviewer, bot, or test finds a bug you introduced, and the finding is valid.
- You find that something you told the user was wrong, and you retract it.

Do not journal a preference the user states before you start, or a finding you reject with a
reason.

## What to capture

- The correction in a few words, and what you had done, with file and line or commit.
- The assumption you made, and where it came from: a default habit, a doc, a similar file, or
  nothing at all. Be specific and do not apologize; the entry is for the next agent.
- Nothing about the user beyond the correction itself.

## Improvements to consider

Recommendations are required here: the `AGENTS.md` rule, lint rule, test, or doc fix that would
have stopped the mistake. When the rule is one the user would not want written down, say so and
leave `recommendations` empty.
