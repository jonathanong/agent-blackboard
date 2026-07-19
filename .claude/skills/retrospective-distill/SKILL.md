---
name: retrospective-distill
description: Distill multiple retrospective entries from agent-blackboard into concrete action items.
when_to_use: Periodically, or when asked to review recent retrospectives and decide what to act on.
---

# Retrospective distill

Turn accumulated retrospectives into a small number of concrete, durable action items — not a
summary of summaries.

## Steps

1. **List sessions, then read each explicitly.** Use `Sessions.list()` or `agent-blackboard sessions
list`; call `entry_get` with each active `sessionId`, then filter client-side for entries where
   `data.type === "retrospective"`. There is intentionally no implicit or cross-session entry read.
2. **Cluster by root cause, not by session.** A theme mentioned in two or more retrospectives is
   recurring — prioritize those over one-offs.
3. **For each high-leverage theme**, check whether it's already tracked (an existing CLAUDE.md
   rule, an open GitHub issue) before proposing something new.
4. **Produce a short action-item list** — a handful of concrete next steps (a CLAUDE.md edit, a
   GitHub issue, a lint rule, a strengthened skill), each tied to the retrospective evidence that
   motivated it. Present this to the user rather than applying changes unprompted, unless you were
   already asked to just go ahead.
5. **Archive completed sessions** with `session_archive` only when every relevant retrospective in
   that session has been distilled. Archival is session-level, not entry-level.

## What this doesn't do

This doesn't record entries or run retrospectives itself — it only consumes what
[`/retrospective`](../retrospective/SKILL.md) already produced. See
[`docs/loop-engineering.md`](../../../docs/loop-engineering.md) for the full write → distill →
feed-back loop this is one part of.
