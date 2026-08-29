export const USAGE = `agent-blackboard — an entry stream for autonomous agents

Usage:
  agent-blackboard sessions create <id> --agent <name> --version <version> [--parent-session-id <id>]
  agent-blackboard sessions ensure <id> --agent <name> --version <version> [--parent-session-id <id>]
  agent-blackboard sessions list [--archived true|false] [--inactive-for-hours <hours>]
  agent-blackboard sessions get <id>
  agent-blackboard sessions patch <id> --data <json>
  agent-blackboard sessions archive <id>
  agent-blackboard append --session-id <id> <json>
  agent-blackboard append --session-id <id> --file <json|markdown|text>
  agent-blackboard get --session-id <id> [--format json|jsonl|markdown]
  agent-blackboard snapshot export [--path <absolute-path>] [--agent <name>] [--version <version>]
    [--parent-session-id <id>|--root-only] [--data <json>] [--inactive-for-hours <hours>]
  agent-blackboard snapshot partition --path <generated-snapshot> --cleanup-token <token> [--max-sessions <count>]
    [--max-bytes <bytes>] [--checksum <sha256>] [--sessions <count> --entries <count> --records <count> --bytes <count>]
  agent-blackboard snapshot cleanup [--path <generated-snapshot>] [--directory <generated-partition-directory>] --cleanup-token <token>
  agent-blackboard credentials <subcommand>
  agent-blackboard mcp

Env:
  AGENT_BLACKBOARD_URL            Server base URL
  AGENT_BLACKBOARD_TOKEN          Client credential
  AGENT_BLACKBOARD_ADMIN_TOKEN    Admin credential
`
