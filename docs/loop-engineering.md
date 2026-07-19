# Loop engineering

`agent-blackboard` provides storage mechanics for an agent improvement loop. It intentionally does
not decide what an agent should record.

During work, create an explicit root session, then append concrete findings and changes as they
happen. Each subagent creates a separate child session and writes to it. `data` stays unstructured so
project-specific skills can attach decisions, file names, branch names, PRs, or error details.

At the end of a session:

1. Call `entry_get` with that exact session id.
2. Combine the recorded entries with important context still in memory.
3. Append one retrospective entry to the same active session.
4. Archive the session only when no more entries need to be written.

For periodic distillation, list sessions, select the relevant session ids, and read each explicitly.
Turn recurring observations into concrete follow-ups such as documentation, lint rules, tests, or
issues. There is no cross-session entry query and no per-entry archival; callers do this fan-out
client-side, then archive whole sessions when appropriate.
