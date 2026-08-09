# Agent hosts

The plugin registers the `agent-blackboard` stdio MCP server and a usage skill for Claude Code and
Codex. It deliberately has no session hook or state file: host session identifiers are not a stable
cross-host contract, and the service must never infer ids.

At the start of work, the root agent chooses an id and calls:

```json
{
  "name": "session_create",
  "arguments": {
    "sessionId": "root-123",
    "parentSessionId": null,
    "agent": "claude-code",
    "version": "1.0.13"
  }
}
```

Before delegating, the root tells the subagent both ids. The subagent creates its own session:

```json
{
  "name": "session_create",
  "arguments": {
    "sessionId": "worker-456",
    "parentSessionId": "root-123",
    "agent": "claude-code",
    "version": "1.0.13"
  }
}
```

Every later `entry_*` call includes that agent's own `sessionId`. A new chat, `/clear`, resumed
conversation, or compacted context does nothing implicitly; the caller must retain or deliberately
choose the id it wants to use.

The plugin needs `AGENT_BLACKBOARD_URL` and `AGENT_BLACKBOARD_TOKEN` in the host environment. Its
MCP configuration runs `npx -y agent-blackboard@0.1.1 mcp`.
