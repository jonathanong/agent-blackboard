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
4. Leave the session unarchived; ordinary completion and inactivity are not archival boundaries.

For periodic distillation, use
[`retrospective-distill`](../.agent/skills/retrospective-distill/SKILL.md) to read relevant sessions
explicitly and turn blackboard evidence into concrete tickets, documentation, lint rules, tests, or
workflow improvements. For a large pass, `snapshot_export` writes all selected active sessions and
entries to an immutable JSONL file and returns only compact metadata. Callers can partition that
file into bounded whole-session groups, let read-only subagents inspect those files, merge compact
disposition summaries in the root agent, and then remove all snapshot and partition files. The
server does not decide readiness, partitioning, disposition, or cleanup policy.

There is no per-entry archival; callers archive each session exactly once only after its evidence
has a completed disposition.
Use the optional `inactiveForHours` session-search filter (for example, `8`) when a distillation
pass should ignore recently-written sessions. Archived sessions may still accept entries for
inspection, but those later entries are intentionally not retrospectively synthesized or
distilled.
