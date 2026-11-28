#!/usr/bin/env bash
# Seeds this attempt's blackboard; runs in the workspace before the agent starts.
set -euo pipefail
exec </dev/null
"$(dirname "$(command -v agent-blackboard)")/../eval-harness/install.sh"
agent-blackboard sessions create cc-old-19 --agent claude-code --version 2.1.3 >/dev/null
agent-blackboard sessions patch cc-old-19 --data '{"repositories":["jongleberry/agent-blackboard"]}' >/dev/null
agent-blackboard append --session-id cc-old-19 '{"repositories":["jongleberry/agent-blackboard"],"finding":"release notes job needs a token"}' >/dev/null
agent-blackboard sessions archive cc-old-19 >/dev/null
# A read makes the harness write report.md, so graders see an empty blackboard as empty.
agent-blackboard sessions list >/dev/null
