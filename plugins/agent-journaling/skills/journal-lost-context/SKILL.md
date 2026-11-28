---
name: journal-lost-context
description: Use when you resume work after a handoff, compaction, or another agent's session and have to rediscover what was done - which branch, what was tried, why a choice was made - because it was not written down. Journals to agent-blackboard what was missing and where it should have been recorded.
---

# Journal lost context

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

Rediscovering state that an earlier session knew is friction that a note would have prevented.
Journal it with the `journal` skill, `trigger: "lost-context"`, once you have rebuilt what you need.

## When

- After a handoff, a context compaction, or picking up another agent's branch or pull request,
  you had to reread code, logs, or history to learn what was already done or decided.
- You redid work, or repeated an approach that had already failed, because nothing said so.
- A pull request, issue, or handoff note was missing the state you needed: the next step, the
  open question, or what had been ruled out.

Do not journal reading you would have done anyway to understand the code.

## What to capture

- What you were missing, and how you rebuilt it (the commands, files, or entries you read).
- How long it took, roughly, and any work you redid.
- References to the earlier session, pull request, or issue.

## Improvements to consider

- The handoff or pull request template field that would have held it.
- An earlier journal entry that should have been written: say which trigger it was.
- An `AGENTS.md` rule for what a handoff must include.
