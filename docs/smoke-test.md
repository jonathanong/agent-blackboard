# Real-agent smoke test

This is a prompt for a real agent, not an automated test. Run it after session contracts, MCP tools,
or plugin manifests change. Use a fresh client credential against the deployed service or a local
server started with `AGENT_BLACKBOARD_STORE=memory pnpm --dir packages/server run dev`.

## Prompt

> Test agent-blackboard only through its MCP tools. Do not use the CLI or HTTP API.
>
> 1. Choose a unique root session id. Call `session_create` with that id and
>    `parentSessionId: null`.
> 2. Call `entry_append` for the root with `{"marker":"root-before"}`. Save the returned
>    `createdAt`.
> 3. Call `entry_get` for the root and verify exactly that entry is visible.
> 4. Call `entry_patch` with the root id, saved `createdAt`, and `{"patched":true}`. Read again and
>    verify the original marker remains and `patched` was shallow-merged.
> 5. Spawn one real subagent. Give it the root id and a unique child id. Tell it to call
>    `session_create` with its child id and the root as `parentSessionId`, append
>    `{"marker":"child"}` to its own session, read its own entries, and report both returned
>    objects verbatim.
> 6. In the root, call `entry_get` for both ids. Verify the child entry is absent from the root and
>    present in the child. Call the session-listing client or CLI only if needed to verify the
>    child's `parentSessionId` equals the root id.
> 7. Call `session_archive` for the child. Verify `entry_get`, `entry_append`, and `entry_patch` all
>    reject the archived child. Also verify creating a grandchild under it is rejected.
> 8. Verify omitted `sessionId`, omitted `parentSessionId`, and appending to a never-created session
>    are rejected. Confirm no id was silently generated.
> 9. Report every tool call, returned session/entry shape, status, and invariant failure. Do not
>    modify repository files.

The smoke passes only if root and child sessions remain separate, the child points directly to the
root, entry identity is `(sessionId, createdAt)`, and archive enforcement is consistent.
