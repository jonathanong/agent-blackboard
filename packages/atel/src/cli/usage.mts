export const USAGE = `atel — telemetry for autonomous agents

Usage:
  atel append <json>              Append one entry (or pipe JSON via stdin)
  atel get [flags]                Stream entries to stdout
  atel patch <id> [flags]         Patch one entry (or --file <path> for a batch)
  atel credentials <subcommand>   create | list | delete (admin-only)
  atel mcp                        Start the MCP stdio server

Get flags:
  --session-id <id>     Defaults to the resolved current session
  --agent <name>        Filter by agent
  --archived true|false Filter by archived status
  --format json|jsonl|markdown   Defaults to json
  --all-sessions         Read across every session for this credential

Env:
  ATEL_URL            Server base URL
  ATEL_TOKEN          Telemetry credential
  ATEL_ADMIN_TOKEN    Admin credential (credentials subcommand only)
`
