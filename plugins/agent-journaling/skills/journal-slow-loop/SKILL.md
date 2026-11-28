---
name: journal-slow-loop
description: Use when a build, test suite, CI run, or install is slow enough that you waited minutes, ran only part of it, or skipped it - a slow feedback loop. Journals to agent-blackboard the command, how long it took, what you did instead, and the change that would make it fast.
---

# Journal a slow feedback loop

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

A slow loop costs every agent on every change, and nobody journals waiting. Journal it with the
`journal` skill, `trigger: "slow-loop"`, once the run finishes or you give up on it.

## When

- A local command you needed to check your change took more than about two minutes.
- You ran a narrower command, or skipped one, because the full one was too slow.
- A CI run took long enough that you moved on to other work while waiting, or a job spent most of
  its time on setup (installs, downloads, container pulls).

Do not journal a run that was slow once because the machine was busy, or a wait for a human.

## What to capture

- The command or job, how long it took (measured, not guessed), and where the time went when you
  can see it: the slowest step, test file, or install.
- What you ran instead, so the next agent can use it ("`pnpm vitest run src/retry` takes 4 s").

## Improvements to consider

- A focused command documented in `AGENTS.md`, such as one package's tests.
- A cache for an install or download in CI, or a job split into shards.
- The slow test to speed up or move out of the default run, by file.
