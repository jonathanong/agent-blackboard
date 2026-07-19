---
name: retrospective
description: Run a retrospective on the current (or a given) work session — review what was recorded and what actually happened, then append one durable summary entry back to agent-blackboard.
when_to_use: At the end of a substantial work session, when explicitly asked to run a retrospective, or before /clear if there's unrecorded value in the session worth capturing.
---

# Retrospective

Reflect on a work session and capture a durable summary — not a re-narration of every step, but
what would help a future session (yours or another agent's) avoid repeated friction or build on a
decision already made.

## Steps

1. **Identify the explicit session id.** Never infer or generate it. If it is not already in the
   conversation or task context, ask the user.
2. **Pull this session's entries.** Call `entry_get` with `sessionId` (or `agent-blackboard get
--session-id <id>`). This is what was captured contemporaneously, as friction happened
   — a partial record, not the whole session.
3. **Review what actually happened this session** from your own memory of it — what was
   attempted, what changed, what took more turns than expected, any non-obvious decisions and why.
   Recorded entries won't cover everything; this step fills the gaps between them. If a session
   transcript/log is available and readable for your host, consult it too, but don't block on
   finding one — your own context is the primary source.
4. **Write one retrospective entry**, appended via `entry_append` with the same `sessionId` and
   `data: { "type": "retrospective", "summary": "..." }` (add whatever else is useful — key
   decisions, files touched, open threads). Keep it dense and synthesized, not a concatenation of
   the raw entries you pulled in step 1.
5. Leave the session active — archiving is `/retrospective-distill`'s job,
   not this skill's.

## What this doesn't do

This doesn't decide what to _do_ about the retrospective. Clustering multiple retrospectives into
concrete action items is [`/retrospective-distill`](../retrospective-distill/SKILL.md)'s job,
usually run later, across several sessions at once. See
[`docs/loop-engineering.md`](../../../docs/loop-engineering.md) for the full write → distill →
feed-back loop this is one part of.
