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
MCP configuration runs `npx -y agent-blackboard@0.5.0 mcp`.

## Cursor

Cursor uses a project-level `.cursor/mcp.json` (or the global `~/.cursor/mcp.json`) with the
standard `mcpServers` shape. Add this entry and restart Cursor:

```json
{
  "mcpServers": {
    "agent-blackboard": {
      "command": "npx",
      "args": ["-y", "agent-blackboard@0.5.0", "mcp"],
      "env": {
        "AGENT_BLACKBOARD_URL": "${env:AGENT_BLACKBOARD_URL}",
        "AGENT_BLACKBOARD_TOKEN": "${env:AGENT_BLACKBOARD_TOKEN}"
      }
    }
  }
}
```

Keep the URL and client token in environment variables; do not commit credentials. Cursor desktop
resolves the `env:` placeholders. Cursor CLI users must also export both variables in the shell that
starts `cursor-agent`. Cursor's MCP configuration is separate from the Codex and Claude plugin
manifests.

## OpenCode v1

OpenCode v1 uses a local server entry under `mcp` in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent-blackboard": {
      "type": "local",
      "command": ["npx", "-y", "agent-blackboard@0.5.0", "mcp"],
      "environment": {
        "AGENT_BLACKBOARD_URL": "{env:AGENT_BLACKBOARD_URL}",
        "AGENT_BLACKBOARD_TOKEN": "{env:AGENT_BLACKBOARD_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

OpenCode's environment placeholders resolve from the process environment. The server is local
stdio; a deployed URL alone is not an OpenCode remote MCP endpoint.

## Grok

Grok custom connectors accept a public remote MCP URL. This release provides the MCP server as a
local stdio process (`npx -y agent-blackboard@0.5.0 mcp`), not a remote MCP transport, so there is
no Grok connector configuration. Do not paste the client token into a public URL. A future remote
MCP deployment can be added in Grok under Connectors → New Connector → Custom once it has a
publicly reachable MCP URL and an authentication contract.
