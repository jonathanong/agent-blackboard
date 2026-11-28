#!/usr/bin/env bash
# Runs the eval suite: Sonnet runs the cases, Opus judges them, with a no-plugin baseline arm.
# Usage: scripts/run-evals.sh [tag ...]   (tags: a skill name, or priority-critical/high/medium)
# Extra `claude plugin eval` flags go in EVAL_FLAGS, e.g. EVAL_FLAGS='--runs 1' for a pilot.
# Never add --mocks off, --allow-real-servers, --scaffold, or --allow-tools: the cases are
# plan-only, and the plugin's real MCP server would write to whatever AGENT_BLACKBOARD_URL is set.
#
# The plugin root is the repository root, so a checkout with node_modules/ makes every attempt
# fail to spawn with E2BIG. The suite runs against a copy of only the plugin's own files.
set -euo pipefail

cd "$(dirname "$0")/.."
root=$PWD
tags=()
if [ "$#" -gt 0 ]; then
  tags=(--tag "$@")
fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/agent-blackboard-evals.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp -R .claude-plugin plugins "$stage/"
mkdir "$stage/evals"
for dir in evals/*/; do
  case $dir in evals/results/ | evals/live/) ;; *) cp -R "$dir" "$stage/evals/" ;; esac
done
mkdir -p evals/results

# shellcheck disable=SC2086 # EVAL_FLAGS is a list of flags.
claude plugin eval "$stage" \
  --trust-plugin \
  --model "${EVAL_MODEL:-claude-sonnet-5-5}" \
  --judge-model "${EVAL_JUDGE_MODEL:-opus}" \
  --concurrency "${EVAL_CONCURRENCY:-6}" \
  --ablation "${EVAL_ABLATION:-with-without}" \
  --max-cost-usd "${EVAL_MAX_COST_USD:-40}" \
  --no-publish \
  --keep-temp \
  --output-dir "$root/evals/results/$(date -u +%Y-%m-%dT%H-%M-%SZ)" \
  --json "$root/evals/results/latest.json" \
  ${EVAL_FLAGS:-} \
  ${tags[@]+"${tags[@]}"}
