#!/usr/bin/env bash
# Runs the live eval suite (evals/live/): the installed plugin, skills plus its MCP server,
# against the agent-blackboard CLI alone. Sonnet runs the cases, Opus judges them.
# Usage: scripts/run-evals-live.sh [tag ...]   Extra `claude plugin eval` flags go in EVAL_FLAGS.
#
# No attempt can reach a real server. The script starts evals/live/harness/harness.mjs as a
# local server, and the staged plugin's MCP server and the `agent-blackboard` on PATH are that
# same harness, which keeps each attempt's blackboard in its own workspace and ignores
# AGENT_BLACKBOARD_URL. The script also unsets that variable and the tokens, and refuses to run
# if the staged MCP config is not the harness.
set -euo pipefail

cd "$(dirname "$0")/.."
root=$PWD
tags=()
if [ "$#" -gt 0 ]; then
  tags=(--tag "$@")
fi

stage=$(mktemp -d /tmp/agent-blackboard-evals-live.XXXXXX)
trap 'rm -rf "$stage"' EXIT
cp -R .claude-plugin plugins "$stage/"
mkdir -p "$stage/evals" "$stage/bin" "$stage/eval-harness"
cp -R evals/live "$stage/evals/"
rm -rf "$stage/evals/live/harness" "$stage/evals/live/generate.py"

harness="$stage/eval-harness"
packages/server/node_modules/.bin/esbuild evals/live/harness/harness.mjs \
  --bundle --platform=node --format=esm --target=node24 --log-level=warning \
  --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" \
  --outfile="$harness/harness.mjs"

node=$(command -v node)
port=${EVAL_HARNESS_PORT:-47811}
# The CLI the agents run. Sandboxed Bash reaches the server only through the sandbox's network
# proxy, which node's fetch uses only with NODE_USE_ENV_PROXY set and localhost not exempt.
{
  echo '#!/bin/sh'
  echo "NODE_USE_ENV_PROXY=1 NO_PROXY= no_proxy= EVAL_HARNESS_PORT=$port exec \"$node\" \"__BUNDLE__\" cli \"\$@\""
} > "$harness/wrapper.tmpl"
sed "s#__BUNDLE__#$harness/harness.mjs#" "$harness/wrapper.tmpl" > "$stage/bin/agent-blackboard"
chmod +x "$stage/bin/agent-blackboard"
# Every scaffold runs this first. Sandboxed Bash can read the plugin root only in the arm that
# has the plugin, so the CLI is copied into the attempt's own HOME, on PATH as ~/.local/bin.
cp evals/live/harness/install.sh "$harness/install.sh"

mcp="$stage/plugins/agent-blackboard/.claude-mcp.json"
printf '{"mcpServers":{"agent-blackboard":{"command":"%s","args":["%s/harness.mjs","mcp"],"env":{"EVAL_HARNESS_PORT":"%s"}}}}\n' \
  "$node" "$harness" "$port" > "$mcp"
if grep -q -e npx -e https: "$mcp"; then
  echo "refusing to run: $mcp does not point at the eval harness" >&2
  exit 1
fi

EVAL_HARNESS_PORT=$port "$node" "$harness/harness.mjs" serve > "$stage/server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null; rm -rf "$stage"' EXIT
for _ in $(seq 50); do
  grep -q listening "$stage/server.log" && break
  kill -0 "$server" 2>/dev/null || break
  read -r -t 0.2 _ < /dev/zero 2>/dev/null || true
done
grep -q listening "$stage/server.log" || { cat "$stage/server.log" >&2; echo "eval harness did not start" >&2; exit 1; }
mkdir -p evals/results

# CLAUDE_TMPDIR from a parent Claude Code session leaks into the attempts' sandbox paths, so it
# is unset with the blackboard variables. `~/.local/bin` stays literal: bash expands it per
# attempt to that attempt's HOME.
# shellcheck disable=SC2086 # EVAL_FLAGS is a list of flags.
env -u CLAUDE_TMPDIR -u TMPDIR -u AGENT_BLACKBOARD_URL -u AGENT_BLACKBOARD_TOKEN \
  -u AGENT_BLACKBOARD_ADMIN_TOKEN -u AGENT_BLACKBOARD_OUTBOX_DIR \
  PATH="$stage/bin:~/.local/bin:$PATH" \
  claude plugin eval "$stage" \
  --trust-plugin \
  --scaffold \
  --allow-real-servers \
  --allow-tools Bash Write Edit "WebFetch(domain:localhost)" "mcp__plugin_agent-blackboard_agent-blackboard__*" \
  --model "${EVAL_MODEL:-claude-sonnet-5-5}" \
  --judge-model "${EVAL_JUDGE_MODEL:-opus}" \
  --concurrency "${EVAL_CONCURRENCY:-4}" \
  --ablation "${EVAL_ABLATION:-with-without}" \
  --max-cost-usd "${EVAL_MAX_COST_USD:-60}" \
  --no-publish \
  --keep-temp \
  --output-dir "$root/evals/results/live-$(date -u +%Y-%m-%dT%H-%M-%SZ)" \
  --json "$root/evals/results/live-latest.json" \
  ${EVAL_FLAGS:-} \
  ${tags[@]+"${tags[@]}"}
