---
name: retrospective-distill
description: Distill multiple retrospective entries from agent-journal into concrete action items.
when_to_use: Periodically, or when asked to review recent retrospectives and decide what to act on.
---

# Retrospective distill

Turn accumulated retrospectives into a small number of concrete, durable action items — not a
summary of summaries.

## Steps

1. **Pull retrospectives.** `journal_get` across sessions (no `sessionId`, i.e. all sessions —
   `agent-journal get --all-sessions` on the CLI), `archived: false`, then filter client-side for
   entries where `data.type === "retrospective"` — agent-journal only supports simple top-level
   equality filters server-side, not nested-field filters (see
   [`architecture.md`](../../../docs/architecture.md)).
2. **Cluster by root cause, not by session.** A theme mentioned in two or more retrospectives is
   recurring — prioritize those over one-offs.
3. **For each high-leverage theme**, check whether it's already tracked (an existing CLAUDE.md
   rule, an open GitHub issue) before proposing something new.
4. **Produce a short action-item list** — a handful of concrete next steps (a CLAUDE.md edit, a
   GitHub issue, a lint rule, a strengthened skill), each tied to the retrospective evidence that
   motivated it. Present this to the user rather than applying changes unprompted, unless you were
   already asked to just go ahead.
5. **Archive what you distilled**: `journal_patch` the retrospective entries you actually used,
   `{ "archived": true }`. Leave anything you didn't act on unarchived for a future pass.

## What this doesn't do

This doesn't journal or run retrospectives itself — it only consumes what
[`/retrospective`](../retrospective/SKILL.md) already produced. See
[`docs/loop-engineering.md`](../../../docs/loop-engineering.md) for the full write → distill →
feed-back loop this is one part of.
