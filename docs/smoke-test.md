# Real-agent smoke test

This is a prompt for a real agent, not an automated test. Run it after session contracts, CLI/MCP
tools, or plugin manifests change. Use a fresh client credential against the deployed service or a
local server started with `AGENT_BLACKBOARD_STORE=memory pnpm --dir packages/server run dev`.

## Prompt

> Test agent-blackboard through both its CLI and MCP tools. Do not call the HTTP API directly.
>
> 1. Choose a unique root session id. With the CLI, create it using `--agent <your-agent>` and
>    `--version <your-version>` with no parent. Get it and verify `parentSessionId: null`, the exact
>    agent/version, `data: {}`, `lastEntryAt: null`, `archivedAt: null`, and server-generated
>    `createdAt`.
> 2. Create temporary `.json`, `.md`, and `.txt` files. Use CLI `append --file` for each. Verify the
>    JSON object is used directly, Markdown becomes `{ "markdown": "..." }`, and text becomes
>    `{ "text": "..." }`, with contents preserved exactly. Verify the session's `lastEntryAt`
>    equals the newest appended entry's `createdAt`. Remove the temporary files.
> 3. Use CLI `sessions patch <root> --data '{"branch":"smoke"}'`. Get the root and verify the data
>    was shallow-merged without changing its identity, parent, agent, version, or timestamps.
> 4. Through MCP, append `{"marker":"root-mcp"}` to the root, save its `createdAt`, patch it with
>    `{"patched":true}`, and read it back. Verify both fields remain.
> 5. Spawn one real subagent. Give it the root id and a unique child id. Tell it to use MCP
>    `session_create` with its actual agent and version and the root as `parentSessionId`; append
>    `{"marker":"child"}`; read its entries; and report the returned objects verbatim.
> 6. In the root, use MCP to read both sessions' entries. Verify child entries are isolated from the
>    root. Call `session_search` with `archived: 0` and exact root/child metadata filters;
>    verify it returns the expected complete sessions. Use CLI `sessions get <child>` to verify its
>    parent, agent, and version. Exercise `inactiveForHours` through MCP and CLI; verify a session
>    with no entries is excluded and the strict cutoff behavior agrees across both interfaces.
> 7. Archive the child through MCP. Verify its session and entries remain readable through both MCP
>    and CLI. Append another child entry and verify it succeeds, advances `lastEntryAt`, and leaves
>    the original `archivedAt` unchanged. Verify a session data patch fails, while creating a
>    grandchild under the archived child succeeds and does not change the parent.
> 8. Verify CLI `sessions list` excludes the child by default and `sessions list --archived true`
>    includes it with a non-null `archivedAt`. Verify MCP `session_search` behaves the same way:
>    `archived: 0` excludes the child and `archived: 1` finds it.
> 9. Use CLI `snapshot export` with an absolute temporary path and filters matching the root. Verify
>    stdout contains only path/counts/checksum/manifest, the JSONL file ends in a complete manifest,
>    counts and checksum match its bytes, and the file is read-only. Use MCP `snapshot_export`
>    without a path and verify the same compact result, that archived sessions are absent, and no
>    entry records crossed MCP. Remove both snapshot files.
> 10. Across CLI and MCP, verify omitted session id, parent id, agent, or version is rejected. Verify
>     appending to a never-created session is rejected and no id was silently generated.
> 11. Report every command/tool call, returned session/entry shape, and invariant failure. Do not
>     modify repository files.

The smoke passes only if both interfaces agree, root and child sessions remain separate, the child
points directly to the root, entry identity is `(sessionId, createdAt)`, inactivity filtering is
consistent, and archived metadata remains immutable while entries and child creation remain
available.
