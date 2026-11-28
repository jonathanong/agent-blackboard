#!/usr/bin/env bash
# Seeds this attempt's blackboard; runs in the workspace before the agent starts.
set -euo pipefail
exec </dev/null
"$(dirname "$(command -v agent-blackboard)")/../eval-harness/install.sh"
agent-blackboard sessions create cc-a1 --agent claude-code --version 2.1.3 >/dev/null
agent-blackboard sessions patch cc-a1 --data '{"repositories":["jongleberry/pr-shepherd"]}' >/dev/null
agent-blackboard append --session-id cc-a1 '{"repositories":["jongleberry/pr-shepherd"],"finding":"pr-shepherd watch exited 0 while a required check was still queued; had to re-run by hand"}' >/dev/null
agent-blackboard sessions create cc-b2 --agent claude-code --version 2.1.3 >/dev/null
agent-blackboard sessions patch cc-b2 --data '{"repositories":["jongleberry/pr-shepherd"]}' >/dev/null
agent-blackboard append --session-id cc-b2 '{"repositories":["jongleberry/pr-shepherd"],"finding":"watch reported done before the queued lint check started; PR merged red"}' >/dev/null
agent-blackboard sessions create codex-c3 --agent codex --version 0.9.1 >/dev/null
agent-blackboard sessions patch codex-c3 --data '{"repositories":["jongleberry/pr-shepherd"]}' >/dev/null
agent-blackboard append --session-id codex-c3 '{"repositories":["jongleberry/pr-shepherd"],"note":"README typo in install section"}' >/dev/null
agent-blackboard append --session-id codex-c3 '{"repositories":["jongleberry/pr-shepherd"],"note":"tests green"}' >/dev/null
# A read makes the harness write report.md, so graders see an empty blackboard as empty.
agent-blackboard sessions list >/dev/null
