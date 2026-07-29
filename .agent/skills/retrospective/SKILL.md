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

1. Read the session metadata first. With MCP, call
   `session_search({ "sessionId": "<sessionId>", "archived": 1 })`; if it returns the session,
   report its `archivedAt` and stop without reading entries or appending. Otherwise call the same
   search with `archived: 0` and stop with `session_not_found` if it is absent. With the CLI, use
   `agent-blackboard sessions get <sessionId>` and apply the same `archivedAt` check.
2. Stop ongoing work and stop `$blackboard` appends for this session.
3. Read every entry with `entry_get({ "sessionId": "<sessionId>" })` or:

   ```sh
   agent-blackboard get --session-id <sessionId> --format json
   ```

4. If an entry already has `data.type === "retrospective"`, do not append another. Report its
   `createdAt` and stop.
5. Compare the entries with the current session context. Explicitly recover:

   - the outcome and important changes;
   - decisions and the constraints behind them;
   - reusable learnings and gotchas;
   - failed approaches worth avoiding;
   - validation actually performed;
   - unresolved risks or follow-ups.

6. Call `entry_append` exactly once:

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

7. Return the retrospective's `(sessionId, createdAt)`. Do not append again and do not archive;
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
