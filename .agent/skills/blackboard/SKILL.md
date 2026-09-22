---
name: blackboard
description: Record concrete learnings, findings, and gotchas in the DynamoDB-backed agent-blackboard system while work is ongoing. Use when an agent or subagent discovers new evidence, surprising behavior, a root cause, or reusable debugging knowledge during a session.
---

# Blackboard

Write evidence while it is fresh. Do not wait until the end of the session; `$retrospective` handles
the final synthesis.

## Required inputs

Obtain these values from the caller or existing task context before writing:

- `sessionId`: this agent's explicit session id;
- `parentSessionId`: `null` for a root or the direct parent's session id for a subagent;
- `agent`: the actual agent name;
- `version`: the actual agent version.
- `repositories`: the repositories relevant to this entry, as one or more canonical
  `owner/name` strings.

Never infer or generate any of them. Ask for missing values.

## Repository tags

Use repository tags whenever the work concerns a repository. Represent them as a sorted,
deduplicated array of lowercase GitHub `owner/name` strings, for example
`["jonathanong/agent-blackboard"]`. Do not use a local path, URL, branch, display name, or an
organization-only value.

An entry's `repositories` describes only the repository or repositories that its evidence actually
concerns. A session's `data.repositories` is the cumulative union of its entries, so it may grow
when work moves across repositories. Existing sessions or entries without this field are legacy
and unclassified; do not infer a tag from their prose or filesystem context.

## Exact procedure

1. Prefer MCP when `session_create` and `entry_append` are available; otherwise use the equivalent
   `agent-blackboard` CLI commands.
2. If the current context already contains a successful `session_create` result for this exact id,
   reuse it. Otherwise call `session_create` once with:

   ```json
   {
     "sessionId": "<sessionId>",
     "parentSessionId": null,
     "agent": "<agent>",
     "version": "<version>"
   }
   ```

   For a subagent, replace `null` with the exact parent session id. If creation returns
   `session_exists`, verify the existing session with `agent-blackboard sessions get <sessionId>`.
   Continue only when its parent, agent, and version match the required inputs; otherwise stop and
   report the conflict. If the CLI is unavailable, stop rather than writing to an unverified
   session.

3. Before every append, read or retain the current session repository list, merge it with the
   entry's `repositories`, normalize the union, and call `session_patch` with:

   ```json
   {
     "sessionId": "<sessionId>",
     "data": { "repositories": ["owner/name"] }
   }
   ```

   Wait for this patch to succeed before appending. Stop and report a patch failure; never append
   an entry whose repository tags are absent from the session union. Do not patch an archived
   session; begin a new session for new work after archival.

4. Choose exactly one entry type using this order:

   - `gotcha`: a surprising failure mode, constraint, trap, or easy-to-repeat mistake;
   - `learning`: a reusable technique or general rule that avoids future work;
   - `finding`: an observed fact or root cause that is neither of the above.

   When categories overlap, choose the first matching type in that list.

5. Call `entry_append` immediately with this shape:

   ```json
   {
     "sessionId": "<sessionId>",
     "data": {
       "type": "finding",
       "repositories": ["owner/name"],
       "summary": "One concrete observation",
       "evidence": "The command, error, file, test, or behavior that proves it",
       "impact": "Why another agent should care"
     }
   }
   ```

6. Add optional `files`, `commands`, or `decision` fields only when they improve reuse.
7. Entries are append-only. To enrich an earlier observation, call `entry_append` again with a new
   entry rather than modifying the original — reference the earlier entry's `createdAt` in the new
   entry's `data` if the connection isn't otherwise obvious.
8. Continue the assigned work. Do not archive the session.

Do not log routine progress, placeholder text, unsupported guesses, or vague narration.

## Subagent protocol

Before spawning a subagent, include this block in its task:

```text
Your agent-blackboard sessionId is <childSessionId>.
Your parentSessionId is <thisAgentSessionId>.
Use agent <agent> version <version>.
Create that child session before writing. Use $blackboard for concrete learnings, findings, and
gotchas. Write only to the child session, never the parent. Return the child sessionId and every
appended entry's createdAt with your result.
```

Do not spawn until the caller has supplied the explicit child session id, agent, and version. Treat
missing values as blocking. Require the subagent to follow this skill itself; do not copy its
findings into the parent session.
