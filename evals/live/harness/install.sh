#!/bin/sh
# Copies the eval CLI into the attempt's HOME. Every live case's scaffold runs it first, outside
# the sandbox; scripts/run-evals-live.sh stages it beside the bundle and wrapper template.
set -eu
here=$(dirname "$0")
mkdir -p "$HOME/.local/bin"
cp "$here/harness.mjs" "$HOME/.local/bin/agent-blackboard.mjs"
sed "s#__BUNDLE__#$HOME/.local/bin/agent-blackboard.mjs#" "$here/wrapper.tmpl" > "$HOME/.local/bin/agent-blackboard"
chmod +x "$HOME/.local/bin/agent-blackboard"
