export const USAGE = `agent-blackboard — an entry stream for autonomous agents

Usage:
  agent-blackboard sessions create [<id>] [--agent <name>] --version <version> [--parent-session-id <id>]
  agent-blackboard sessions ensure [<id>] [--agent <name>] --version <version> [--parent-session-id <id>]
  agent-blackboard sessions list [--archived true|false] [--inactive-for-hours <hours>]
  agent-blackboard sessions get <id>
  agent-blackboard sessions patch <id> --data <json>
  agent-blackboard sessions archive <id>
  agent-blackboard append [--session-id <id>] [--schema <id>[@<version>]] <json>
  agent-blackboard append [--session-id <id>] [--schema <id>[@<version>]] --file <json|markdown|text>
  agent-blackboard get [--session-id <id>] [--format json|jsonl|markdown]
  agent-blackboard snapshot export [--path <absolute-path>] [--agent <name>] [--version <version>]
    [--parent-session-id <id>|--root-only] [--data <json>] [--inactive-for-hours <hours>]
  agent-blackboard snapshot partition --path <generated-snapshot> --cleanup-token <token> [--max-sessions <count>]
    [--max-bytes <bytes>] [--checksum <sha256>] [--sessions <count> --entries <count> --records <count> --bytes <count>]
  agent-blackboard snapshot cleanup [--path <generated-snapshot>] [--directory <generated-partition-directory>] --cleanup-token <token>
  agent-blackboard schemas pull [--dir <path>]
  agent-blackboard schemas put <id> <file> [--breaking]
  agent-blackboard schemas remove <id>
  agent-blackboard schemas list
  agent-blackboard schemas get <id>[@<version>]
  agent-blackboard schemas validate <id>[@<version>] <file> [--dir <path>]
  agent-blackboard credentials <subcommand>
  agent-blackboard mcp

Omitted session ids and agents resolve from the harness environment (CLAUDE_CODE_SESSION_ID,
CODEX_THREAD_ID, CURSOR_SESSION_ID, GROK_SESSION_ID) or <worktree>/.local/<harness>-session-id.
Interactive root Codex: --root-codex creates or reuses the worktree id; --new-root-codex-session rotates it.

Env:
  AGENT_BLACKBOARD_URL            Server base URL
  AGENT_BLACKBOARD_TOKEN          Client credential
  AGENT_BLACKBOARD_ADMIN_TOKEN    Admin credential
  AGENT_BLACKBOARD_SCHEMAS_DIR    Optional local schema cache directory
`
