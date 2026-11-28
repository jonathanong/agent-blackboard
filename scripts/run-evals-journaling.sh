#!/usr/bin/env bash
# Runs the journaling eval suite (evals/journaling/) against the agent-journaling plugin: Sonnet
# runs the cases, Opus judges them, with a no-plugin baseline arm.
# Usage: scripts/run-evals-journaling.sh [tag ...]   (tags: a skill name or priority-*)
# Extra `claude plugin eval` flags go in EVAL_FLAGS, e.g. EVAL_FLAGS='--runs 1' for a pilot.
# Never add --mocks off, --allow-real-servers, --scaffold, or --allow-tools: the cases are
# plan-only, and an attempt must never write to whatever AGENT_BLACKBOARD_URL is set.
#
# The plugin is staged on its own, so the with-without ablation turns only its skills on and off.
set -euo pipefail

cd "$(dirname "$0")/.."
root=$PWD
tags=()
if [ "$#" -gt 0 ]; then
  tags=(--tag "$@")
fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/agent-journaling-evals.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp -R plugins/agent-journaling/. "$stage/"
mkdir -p "$stage/evals/journaling"
for dir in evals/journaling/*/; do
  cp -R "$dir" "$stage/evals/journaling/"
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
  --output-dir "$root/evals/results/journaling-$(date -u +%Y-%m-%dT%H-%M-%SZ)" \
  --json "$root/evals/results/journaling-latest.json" \
  ${EVAL_FLAGS:-} \
  ${tags[@]+"${tags[@]}"}
