---
name: retrospective-distill
description: Distill agent-blackboard logs and retrospectives across sessions into concrete actionable items. Use periodically, or when asked to turn accumulated agent and subagent findings, gotchas, and recurring friction into tickets, rules, tests, documentation, or workflow improvements.
---

# Retrospective distill

Coordinate a read-first distillation. Produce owner-ready actions, not another narrative summary.

## Required inputs

Obtain before starting:

- the explicit session ids or a user-approved session-selection rule;
- the target for actions: proposal only, ticket system, or repository changes;
- authorization before creating tickets, editing files, or archiving sessions.

If the scope or mutation authority is missing, perform read-only analysis and present proposals.

## Exact procedure

1. Call `session_search({ "archived": 0 })`. Apply exact `agent`, `version`,
   `parentSessionId`, or `data` filters when the approved scope requires them. Use the returned
   `sessions` array as the active-session worklist. If MCP is unavailable, use
   `agent-blackboard sessions list` as the fallback.
2. For every returned session, call `entry_get({ "sessionId": "<id>" })`. Do not skip sessions
   with no retrospective entry; ongoing blackboard evidence is also input. Keep each entry's `sessionId`,
   `createdAt`, `type`, `summary`, `evidence`, and `impact`. Set a missing optional field to `null`;
   never invent it. Do not mutate anything yet.
3. Group entries across agents and subagents by shared root cause or opportunity. Promote a group
   when it recurs in at least two sessions. Also promote a one-off when its severity or leverage is
   clearly high: data loss, credential exposure, a security boundary failure, an irreversible
   external mutation, or a blocker in the standard workflow. Leave other one-offs as evidence, not
   actions.
4. Check for duplicates only in the authorized destination and the current repository. Search the
   candidate's distinctive nouns plus its affected component. Mark a candidate `duplicate` when an
   existing artifact requests the same concrete change; include that artifact in `reason`.
5. Emit each remaining action in this exact shape:

   ```json
   {
     "title": "Imperative, owner-ready action",
     "change": "The concrete change to make",
     "evidence": [{ "sessionId": "...", "createdAt": "...", "summary": "..." }],
     "benefit": "Expected result",
     "destination": "ticket | CLAUDE.md | test | lint | docs | skill",
     "status": "proposed | duplicate | no-action | created | completed",
     "reason": null
   }
   ```

6. Use `no-action` only when the evidence is invalid, obsolete, or outweighed by a documented
   tradeoff; put the explanation in `reason`. If authorized, create or implement remaining actions
   and change `status` to `created` or `completed`. Preserve the source evidence in the destination.
7. Archive a selected session only after all its relevant evidence maps to a created/completed
   action or an explicit `no-action` decision. Record `archivedAt` from the response.

Reject vague actions such as "improve reliability." Do not append distillation output back into
source sessions.

## Subagent protocol

Use subagents only to parallelize read-only evidence collection across two or more sessions. Give
each subagent a non-overlapping explicit session-id list and this instruction:

```text
Read only these agent-blackboard sessions: <sessionIds>.
Return one JSON array of {sessionId, createdAt, type, summary, evidence, impact}.
Use null for any missing type, summary, evidence, or impact; never infer missing values.
Do not append, patch, archive, create tickets, or edit repository files.
```

The coordinating agent must merge evidence, deduplicate candidates, check existing destinations,
create authorized actions, and archive eligible sessions. Never delegate those mutations.

## Example

```text
1. session_search({"archived":0})
   -> {"sessions":[{"id":"root-2"},{"id":"child-7"}]}
2. entry_get({"sessionId":"root-2"})
3. entry_get({"sessionId":"child-7"})
4. Normalize the returned entries, cluster evidence, check duplicates, and propose actions.
5. Create actions and archive eligible sessions only when explicitly authorized.
```
