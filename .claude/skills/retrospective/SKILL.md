---
name: retrospective
description: Run a retrospective on the current (or a given) work session — review what was recorded and what actually happened, then append one durable summary entry back to atel.
when_to_use: At the end of a substantial work session, when explicitly asked to run a retrospective, or before /clear if there's unrecorded value in the session worth capturing.
---

# Retrospective

Reflect on a work session and capture a durable summary — not a re-narration of every step, but
what would help a future session (yours or another agent's) avoid repeated friction or build on a
decision already made.

## Steps

1. **Pull this session's telemetry entries.** `telemetry_get` (or `atel get`), scoped to the
   current session, unarchived. This is what was captured contemporaneously, as friction happened
   — a partial record, not the whole session.
2. **Review what actually happened this session** from your own memory of it — what was
   attempted, what changed, what took more turns than expected, any non-obvious decisions and why.
   Recorded entries won't cover everything; this step fills the gaps between them. If a session
   transcript/log is available and readable for your host, consult it too, but don't block on
   finding one — your own context is the primary source.
3. **Write one retrospective entry**, appended via `telemetry_append` with
   `data: { "type": "retrospective", "summary": "..." }` (add whatever else is useful — key
   decisions, files touched, open threads). Keep it dense and synthesized, not a concatenation of
   the raw entries you pulled in step 1.
4. Leave the session's other entries as they are — archiving is `/retrospective-distill`'s job,
   not this skill's.

## What this doesn't do

This doesn't decide what to _do_ about the retrospective. Clustering multiple retrospectives into
concrete action items is [`/retrospective-distill`](../retrospective-distill/SKILL.md)'s job,
usually run later, across several sessions at once. See
[`docs/loop-engineering.md`](../../../docs/loop-engineering.md) for the full write → distill →
feed-back loop this is one part of.
