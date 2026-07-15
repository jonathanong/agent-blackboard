export const USAGE = `agent-journal — a journal for autonomous agents

Usage:
  agent-journal append <json>              Append one entry (or pipe JSON via stdin)
  agent-journal get [flags]                Stream entries to stdout
  agent-journal patch <id> [flags]         Patch one entry (or --file <path> for a batch)
  agent-journal credentials <subcommand>   create | list | delete (admin-only)
  agent-journal mcp                        Start the MCP stdio server

Get flags:
  --session-id <id>     Defaults to the resolved current session
  --agent <name>        Filter by agent
  --archived true|false Filter by archived status
  --format json|jsonl|markdown   Defaults to json
  --all-sessions         Read across every session for this credential

Env:
  AGENT_JOURNAL_URL            Server base URL
  AGENT_JOURNAL_TOKEN          Journaling credential
  AGENT_JOURNAL_ADMIN_TOKEN    Admin credential (credentials subcommand only)
`
