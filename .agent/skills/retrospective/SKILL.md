---
name: retrospective
description: Append the final, thorough log for a completed agent-blackboard session. Use at the end of substantial work, including subagent work, before ending or clearing a session, to synthesize ongoing blackboard entries with important context still in memory.
---

# Retrospective

Write exactly one final append for this agent's session. Do not write a retrospective for another
agent's session.

## Required input

Require the explicit `sessionId` owned by this agent. Never infer or generate it. Ask if missing.

## Exact procedure

1. Stop ongoing work and stop `$blackboard` appends for this session.
2. Read every entry with `entry_get({ "sessionId": "<sessionId>" })` or:

   ```sh
   agent-blackboard get --session-id <sessionId> --format json
   ```

3. If an entry already has `data.type === "retrospective"`, do not append another. Report its
   `createdAt` and stop.
4. Compare the entries with the current session context. Explicitly recover:

   - the outcome and important changes;
   - decisions and the constraints behind them;
   - reusable learnings and gotchas;
   - failed approaches worth avoiding;
   - validation actually performed;
   - unresolved risks or follow-ups.

5. Call `entry_append` exactly once:

   ```json
   {
     "sessionId": "<sessionId>",
     "data": {
       "type": "retrospective",
       "summary": "Self-contained, thorough synthesis",
       "decisions": [],
       "learnings": [],
       "validation": [],
       "openThreads": []
     }
   }
   ```

6. Return the retrospective's `(sessionId, createdAt)`. Do not append again and do not archive;
   `$retrospective-distill` owns archival after consuming the evidence.

Use empty arrays when a category has no items. Do not invent evidence or copy the ongoing log
verbatim.

## Subagent protocol

Before a subagent finishes, send it this instruction while its context is still available:

```text
Use $retrospective for your own session <childSessionId>. Read all of that session's entries,
append exactly one final retrospective, do not archive, and return its createdAt.
```

Wait for that result before treating the subagent as complete. Each subagent writes only its own
retrospective. The parent then runs `$retrospective` separately for the parent session. Do not spawn
a replacement subagent to reconstruct another agent's retrospective after its context is gone.
