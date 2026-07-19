# Real-agent smoke test

This is a prompt for a real agent, not an automated test. Run it after session contracts, CLI/MCP
tools, or plugin manifests change. Use a fresh client credential against the deployed service or a
local server started with `AGENT_BLACKBOARD_STORE=memory pnpm --dir packages/server run dev`.

## Prompt

> Test agent-blackboard through both its CLI and MCP tools. Do not call the HTTP API directly.
>
> 1. Choose a unique root session id. With the CLI, create it using `--agent <your-agent>` and
>    `--version <your-version>` with no parent. Get it and verify `parentSessionId: null`, the exact
>    agent/version, `data: {}`, and server-generated `createdAt`.
> 2. Create temporary `.json`, `.md`, and `.txt` files. Use CLI `append --file` for each. Verify the
>    JSON object is used directly, Markdown becomes `{ "markdown": "..." }`, and text becomes
>    `{ "text": "..." }`, with contents preserved exactly. Remove the temporary files.
> 3. Use CLI `sessions patch <root> --data '{"branch":"smoke"}'`. Get the root and verify the data
>    was shallow-merged without changing its identity, parent, agent, version, or timestamps.
> 4. Through MCP, append `{"marker":"root-mcp"}` to the root, save its `createdAt`, patch it with
>    `{"patched":true}`, and read it back. Verify both fields remain.
> 5. Spawn one real subagent. Give it the root id and a unique child id. Tell it to use MCP
>    `session_create` with its actual agent and version and the root as `parentSessionId`; append
>    `{"marker":"child"}`; read its entries; and report the returned objects verbatim.
> 6. In the root, use MCP to read both sessions' entries. Verify child entries are isolated from the
>    root. Use CLI `sessions get <child>` to verify its parent, agent, and version.
> 7. Archive the child through MCP. Verify its session and entries remain readable through both MCP
>    and CLI, while entry append/patch, session data patch, and creating a grandchild all fail.
> 8. Verify CLI `sessions list` excludes the child by default and `sessions list --archived true`
>    includes it with a non-null `archivedAt`.
> 9. Across CLI and MCP, verify omitted session id, parent id, agent, or version is rejected. Verify
>    appending to a never-created session is rejected and no id was silently generated.
> 10. Report every command/tool call, returned session/entry shape, and invariant failure. Do not
>     modify repository files.

The smoke passes only if both interfaces agree, root and child sessions remain separate, the child
points directly to the root, entry identity is `(sessionId, createdAt)`, and archived data remains
readable while immutable.
