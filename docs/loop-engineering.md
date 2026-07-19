# Loop engineering

`agent-blackboard` provides storage mechanics for an agent improvement loop. It intentionally does
not decide what an agent should record.

During work, use the internal [`blackboard`](../.agent/skills/blackboard/SKILL.md) skill to append
concrete learnings, findings, and gotchas as they happen. Each subagent creates a separate child
session and writes to it. `data` stays unstructured so entries can attach evidence, decisions, file
names, branches, PRs, or error details.

At the end of a session:

1. Use [`retrospective`](../.agent/skills/retrospective/SKILL.md) to read that exact session.
2. Combine the recorded entries with important context still in memory.
3. Append one thorough retrospective as the session's final entry.
4. Archive the session only when no more entries need to be written.

For periodic distillation, use
[`retrospective-distill`](../.agent/skills/retrospective-distill/SKILL.md) to read relevant sessions
explicitly and turn blackboard evidence into concrete tickets, documentation, lint rules, tests, or
workflow improvements. There is no cross-session entry query and no per-entry archival; callers do
this fan-out client-side, then archive whole sessions when appropriate.
