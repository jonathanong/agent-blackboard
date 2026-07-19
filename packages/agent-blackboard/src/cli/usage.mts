export const USAGE = `agent-blackboard — an entry stream for autonomous agents

Usage:
  agent-blackboard sessions create <id> [--parent-session-id <id>]
  agent-blackboard sessions list
  agent-blackboard sessions get <id>
  agent-blackboard sessions archive <id>
  agent-blackboard append --session-id <id> <json>
  agent-blackboard get --session-id <id> [--format json|jsonl|markdown]
  agent-blackboard patch --session-id <id> --created-at <timestamp> --data <json>
  agent-blackboard credentials <subcommand>
  agent-blackboard mcp

Env:
  AGENT_BLACKBOARD_URL            Server base URL
  AGENT_BLACKBOARD_TOKEN          Client credential
  AGENT_BLACKBOARD_ADMIN_TOKEN    Admin credential
`
