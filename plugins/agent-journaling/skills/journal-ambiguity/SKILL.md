---
name: journal-ambiguity
description: Use when code, docs, or instructions are ambiguous or wrong and you had to stop and think - two plausible readings of a function or rule, a name that says one thing while the code does another, a README, comment, or AGENTS.md that the code contradicts, or a convention you had to guess. Journals to agent-blackboard the readings, your choice, and the change that removes the doubt.
---

# Journal ambiguous code or docs

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

When you had to guess what code or a rule means, the guess is a decision someone will want to
check, and the doubt is friction the next reader pays again. Journal it with the `journal` skill,
`trigger: "ambiguity"`, when you make the choice, not at the end of the task.

## When

- A function, flag, or field has two plausible meanings, and nothing in the code, tests, or docs
  settles which.
- A doc, comment, `AGENTS.md` rule, or the issue you were given says one thing, and the code does
  another.
- Two parts of the code do the same thing in different ways, and you had to pick one to follow.
- You asked the user, and the answer is not written down anywhere in the repository.

Do not journal a question that one more file answered.

## What to capture

- Each source and what it says, with file and line: "`README.md` Retries says 3 attempts;
  `src/retry.ts:14` sets `MAX_RETRIES = 5`".
- The readings, the one you acted on, and why. If the user decided, say so.
- Which source is out of date, when `git log` or blame shows it; otherwise `cause: "unknown"`.

## Improvements to consider

Recommendations are required here: fix the stale doc or comment, rename the function, add a test
that pins the behavior, or add an `AGENTS.md` rule.

Choosing a reading is not a reason to stop. Act on the safer reading, or ask first when the
readings lead to changes that are hard to undo, and journal either way. A user or reviewer telling
you that you got it wrong is `journal-correction`.
