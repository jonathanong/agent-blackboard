---
name: journal-dev-setup
description: Use when the project itself is hard to set up, install, build, or run locally - a README step that fails or is missing, an undocumented env var, a database or docker service that must be running, or a version mismatch. Journals it to agent-blackboard with the fix and recommendations for the docs or scripts. A sandbox or permission denial is journal-tool-friction.
---

# Journal a hard local setup

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

The next agent will hit the same wall. Check for an earlier journal with the `journal-recall`
skill, then journal it with the `journal` skill, `trigger: "dev-setup"`, as soon as the project
runs, or as soon as you give up on it.

## When

Following the repository's own instructions did not work on the first try:

- a documented command failed, or the docs left out a step you had to find yourself;
- you had to set an env var, start a service, or install a tool that no doc mentions;
- a version of Node, Python, a package manager, or a system library had to be different;
- you had to read source code or CI config to learn how to start the project.

Do not journal a setup that worked as documented, even when it was slow.

## What to capture

- The command, the first error line verbatim, and the doc and section you were following.
- The versions involved (`node --version` and the like).
- What fixed it, as the exact commands.
- `status: "worked-around"` when you got it running without changing the repository.

## Improvements to consider

Recommendations are required here. Prefer a script or a check to a sentence in a doc, because a
script cannot drift out of date unnoticed:

- an `.env.example` entry, a `docker compose` service, or a setup script step;
- a version pin (`engines`, `.nvmrc`, `mise.toml`) or a preinstall check;
- the README step that is missing or wrong, by section.

A sandbox or harness permission that blocked you is not the project's setup: use
`journal-tool-friction`.
