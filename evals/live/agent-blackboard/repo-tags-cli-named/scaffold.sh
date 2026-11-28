#!/usr/bin/env bash
# Seeds this attempt's blackboard; runs in the workspace before the agent starts.
set -euo pipefail
exec </dev/null
"$(dirname "$(command -v agent-blackboard)")/../eval-harness/install.sh"
agent-blackboard sessions create cc-m44 --agent claude-code --version 2.1.3 >/dev/null
agent-blackboard sessions patch cc-m44 --data '{"repositories":["jongleberry/agent-blackboard"]}' >/dev/null
# A read makes the harness write report.md, so graders see an empty blackboard as empty.
agent-blackboard sessions list >/dev/null
