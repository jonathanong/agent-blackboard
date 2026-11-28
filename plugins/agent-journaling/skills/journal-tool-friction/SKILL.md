---
name: journal-tool-friction
description: Use when a tool or the sandbox got in the way and you needed a retry or a workaround - a sandbox or permission denial (EACCES, read-only file system, blocked network), an MCP server or CLI that failed or was missing, a rate limit or hang, a flaky service, or a misleading error. Journals the friction to agent-blackboard with the exact error and the workaround.
---

# Journal tool friction

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

Friction you route around is invisible to the people who could fix it. Check for an earlier
journal with the `journal-recall` skill; most tool friction repeats. Then journal it with the
`journal` skill, `trigger: "tool-friction"`, once the workaround works or you give up on the tool.

## When

- A tool call, MCP server, or CLI failed, and you retried, switched tools, or ran it another way.
- A sandbox, permission, or policy denied a command the task needed.
- An error message sent you the wrong way, and the real cause was something else.
- A command hung, timed out, or hit a rate limit.
- A third-party service was down. Check its status page with the `service-status` skill when you
  have it, and put the outage in `cause`.

Do not journal your own typo fixed on the next try, or a permission prompt that the repository's
docs already say to expect.

## What to capture

- The tool or command, the first error line verbatim, and the exit code or HTTP status.
- The workaround, as the exact command or tool call, and whether it is safe to reuse.
- `status: "worked-around"` unless you fixed the tool itself.
- A denied path or variable by name only. Never its contents or value.

## Improvements to consider

- The tool's error message, when it named the wrong cause.
- A permission or sandbox rule, or an `AGENTS.md` note that says how to run the command.
- A retry, timeout, or fallback in the script that called the tool.
