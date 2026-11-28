#!/usr/bin/env python3
"""Writes every live eval case under evals/live/<skill>/<case>/. Edit this file, never a generated case.

Live cases run the real plugin (skills plus its MCP server) against the CLI alone. Each attempt
gets its own blackboard, seeded by the case's scaffold, and graders read the end state the
harness writes to `.eval-blackboard/report.md` (and the request log beside it).

Usage: python3 evals/live/generate.py   (then run oxfmt on evals/)
"""
import os, textwrap
ROOT = os.path.dirname(os.path.abspath(__file__))
MCP = 'mcp__plugin_agent-blackboard_agent-blackboard__'
TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'] + [MCP + t for t in [
    'session_create', 'session_ensure', 'session_search', 'session_patch', 'session_archive',
    'entry_append', 'entry_get', 'snapshot_export', 'snapshot_partition', 'snapshot_cleanup',
    'outbox_status', 'outbox_flush', 'outbox_prune_rejected']]

# The system prompt does not say how to reach the blackboard. Naming the CLI here made the
# with-plugin agents use it instead of the plugin's MCP tools (HISTORY.md, 2026-11-28); the
# `-cli-named` case keeps that variant for users whose instructions point at the CLI.
CLI_NAMED = """The `agent-blackboard` CLI is on PATH and already configured with a server URL and
token; `agent-blackboard help` lists its commands."""
SYS = """You are working in a scratch directory on a machine set up for agent-blackboard, the
team's session journal, and it is already configured with a server URL and token.{cli} Do not
look for, print, or change that configuration. Do not read or edit the `.eval-blackboard/`
directory: it belongs to the test harness.

Team convention: record real friction, decisions, and findings in agent-blackboard as you work.

You are claude-code 2.1.3. Do the work now; do not ask for confirmation."""

STATE = """The file is the end state of the agent-blackboard server after the agent's run: one
block per session with its parentSessionId, agent, version, archivedAt, data, and every entry.
Sessions and entries the test fixture created before the run are part of it; the prompt says
which ones existed.
"""
LOG = """The file is the server's request log for the run, one JSON line per request that changed
state, in the order the server handled them: `method`, `path`, `body`, and `at`. The first lines
come from the test fixture that seeded the blackboard before the agent started.
"""


def case(skill, name, tags, prompt, scaffold, graders, runs=3, max_turns=30, cli_named=False):
    d = f'{ROOT}/{skill}/{name}'
    os.makedirs(f'{d}/graders', exist_ok=True)
    tools = ', '.join(TOOLS)
    yaml = f"""schema_version: "1.1"
name: live-{name}
runs: {runs}
tags: [live, {', '.join([skill] + tags)}]
context:
  scaffold_script: scaffold.sh
execution:
  model: claude-sonnet-5-5
  max_turns: {max_turns}
  timeout_seconds: 600
  allowed_tools: [{tools}]
  append_system_prompt: |
{textwrap.indent(SYS.format(cli=' ' + CLI_NAMED if cli_named else ''), '    ')}
  prompt: |
{textwrap.indent(prompt.strip(), '    ')}
"""
    open(f'{d}/case.yaml', 'w').write(yaml)
    open(f'{d}/scaffold.sh', 'w').write('#!/usr/bin/env bash\n# Seeds this attempt\'s blackboard; runs in the workspace before the agent starts.\nset -euo pipefail\nexec </dev/null\n'
        + '"$(dirname "$(command -v agent-blackboard)")/../eval-harness/install.sh"\n' + scaffold.strip() + '\n'
        + '# A read makes the harness write report.md, so graders see an empty blackboard as empty.\nagent-blackboard sessions list >/dev/null\n')
    os.chmod(f'{d}/scaffold.sh', 0o755)
    pattern = {'distill': r'"skill"\s*:\s*"(?:[\w-]+:)?distill"', 'agent-blackboard': r'"skill"\s*:\s*"(?:[\w-]+:)?agent-blackboard"'}[skill]
    open(f'{d}/graders/skill-fired.md', 'w').write(f"""---
type: tool_used
tool: Skill
input_match: '{pattern}'
min: 1
---
""")
    for gname, (source, body) in graders.items():
        if source == 'reply':
            focus, intro = 'focus: last_message', ''
        else:
            path = {'state': 'report.md', 'log': 'log.jsonl'}[source]
            focus = f'focus:\n  source: file\n  path: .eval-blackboard/{path}'
            intro = {'state': STATE, 'log': LOG}[source] + '\n'
        open(f'{d}/graders/{gname}.md', 'w').write(f"---\ntype: llm\n{focus}\nweight: 1\n---\n\n{intro}{body.strip()}\n")


AB = 'agent-blackboard'

REPO_TAGS = ("""
My blackboard session is `cc-m44`. I just found that pr-shepherd's merge-queue handling (repo
`JongleBerry/PR-Shepherd`) drops the ejection reason, and that's what broke our release here.
Log it.
""", f"""
{AB} sessions create cc-m44 --agent claude-code --version 2.1.3 >/dev/null
{AB} sessions patch cc-m44 --data '{{"repositories":["jongleberry/agent-blackboard"]}}' >/dev/null
""", {
    'union-and-finding': ('state', """
Before the run, `cc-m44` existed with `data.repositories: ["jongleberry/agent-blackboard"]` and no
entries.

PASS when all of these hold:
- `cc-m44`'s `data.repositories` is exactly `["jongleberry/agent-blackboard", "jongleberry/pr-shepherd"]`
  (lowercase, sorted, no duplicates);
- `cc-m44` has an entry whose data records the finding (pr-shepherd's merge-queue handling drops
  the ejection reason, and that broke the release);
- no `repositories` value anywhere, on a session or an entry, contains the mixed-case
  `JongleBerry/PR-Shepherd`.

FAIL otherwise, including when the finding went to some other session instead of `cc-m44`.
"""),
    'patch-before-append': ('log', """
PASS when the request that PATCHes `/sessions/cc-m44` with `jongleberry/pr-shepherd` in
`repositories` comes before every agent request that POSTs an entry to
`/sessions/cc-m44/entries`. FAIL when an entry was appended to `cc-m44` before that patch, or when
no such patch exists.
"""),
})

case('agent-blackboard', 'repo-tags-patch-before-append', ['priority-high'], *REPO_TAGS)
# The same case with the CLI named in the system prompt, as a CLI user's AGENTS.md would.
case('agent-blackboard', 'repo-tags-cli-named', ['priority-high'], *REPO_TAGS, cli_named=True)

case('agent-blackboard', 'patch-failed-no-append', ['priority-high'], """
My blackboard session is `cc-old-19`. Tag it with jongleberry/pr-shepherd and log this finding
about that repo: "pr-shepherd treats a merge-queue ejection as a CI failure".
""", f"""
{AB} sessions create cc-old-19 --agent claude-code --version 2.1.3 >/dev/null
{AB} sessions patch cc-old-19 --data '{{"repositories":["jongleberry/agent-blackboard"]}}' >/dev/null
{AB} append --session-id cc-old-19 '{{"repositories":["jongleberry/agent-blackboard"],"finding":"release notes job needs a token"}}' >/dev/null
{AB} sessions archive cc-old-19 >/dev/null
""", {
    'not-on-archived-session': ('state', """
Before the run, `cc-old-19` existed, archived, tagged `jongleberry/agent-blackboard`, with one
entry (about the release notes job). Because it is archived, its metadata cannot be patched, so
it can never carry the `jongleberry/pr-shepherd` tag.

PASS when all of these hold:
- `cc-old-19` still has exactly one entry, the original one;
- another session, not archived, has `jongleberry/pr-shepherd` in its `data.repositories`, and an
  entry on it records the finding (pr-shepherd treats a merge-queue ejection as a CI failure).
  Its parentSessionId may be null or `cc-old-19`.

FAIL when the finding was appended to `cc-old-19`, or when no other session records it with the
tag.
"""),
})

case('agent-blackboard', 'subagent-sessions-direct-parent', ['priority-high'], """
I'm the orchestrator for a refactor in jongleberry/agent-blackboard. My own blackboard session is
`cc-root-7f2`, already created. I'm about to dispatch two workers, `worker-api` and `worker-cli`
(both claude-code 2.1.3), and `worker-cli` will hand a chunk of its work to its own helper,
`helper-cli-docs`. Set up the journaling for all three now, before I dispatch them: give each its
place on the blackboard and record one first entry for each saying what it will work on, so I
can trace who did what afterwards. Then tell me what to pass each worker.
""", f"""
{AB} sessions create cc-root-7f2 --agent claude-code --version 2.1.3 >/dev/null
""", {
    'direct-parent-links': ('state', """
Before the run only `cc-root-7f2` existed, with no entries.

PASS when there are three new sessions, one each for `worker-api`, `worker-cli`, and
`helper-cli-docs` (recognizable by id, data, or entry content), where:
- the `worker-api` and `worker-cli` sessions have `parentSessionId: "cc-root-7f2"`;
- the `helper-cli-docs` session has `parentSessionId` equal to the `worker-cli` session's id,
  not `cc-root-7f2`;
- each of the three has at least one entry.

FAIL when the workers' entries went into `cc-root-7f2` or a shared session, the helper is
parented on `cc-root-7f2`, or any of the three sessions is missing.
"""),
})

case('agent-blackboard', 'friction-misleading-error', ['priority-medium', 'loading'], """
`./check.sh` fails. Make it pass without changing `check.mjs`.
""", """
cat > check.sh <<'EOF'
#!/usr/bin/env bash
node check.mjs
EOF
chmod +x check.sh
cat > check.mjs <<'EOF'
import { readFileSync } from 'node:fs'
const config = JSON.parse(readFileSync('config.json', 'utf8'))
if (typeof config.retries !== 'number') {
  console.error('config.json is missing "retries"')
  process.exit(1)
}
console.log('ok')
EOF
cat > config.json <<'EOF'
{ "name": "billing-sync", "retries": "3" }
EOF
""", {
    'records-friction': ('state', """
Before the run the blackboard was empty. The agent fixed a check whose error said `config.json`
was missing "retries" when the key was present but held the string "3" instead of a number.

PASS when some session has an entry that records this misleading error with concrete evidence:
it names the file or the check and says the message claims the key is missing while the real
problem is its type (string instead of number). The session must have an explicit agent and
version.

FAIL when there is no such entry, or the only entries are vague progress notes ("fixed the
check") with no description of the misleading message.
"""),
}, runs=8)

SEED = [
    ('cc-a1', 'claude-code', '2.1.3', ['{"repositories":["jongleberry/pr-shepherd"],"finding":"pr-shepherd watch exited 0 while a required check was still queued; had to re-run by hand"}']),
    ('cc-b2', 'claude-code', '2.1.3', ['{"repositories":["jongleberry/pr-shepherd"],"finding":"watch reported done before the queued lint check started; PR merged red"}']),
    ('codex-c3', 'codex', '0.9.1', ['{"repositories":["jongleberry/pr-shepherd"],"note":"README typo in install section"}', '{"repositories":["jongleberry/pr-shepherd"],"note":"tests green"}']),
]
seed = '\n'.join(
    f"{AB} sessions create {sid} --agent {agent} --version {version} >/dev/null\n"
    f"{AB} sessions patch {sid} --data '{{\"repositories\":[\"jongleberry/pr-shepherd\"]}}' >/dev/null\n"
    + '\n'.join(f"{AB} append --session-id {sid} '{entry}' >/dev/null" for entry in entries)
    for sid, agent, version, entries in SEED)

case('distill', 'no-archive-unless-asked', ['priority-high'], """
Go through the blackboard sessions from jongleberry/pr-shepherd and tell me what we should fix.
""", seed, {
    'does-not-archive': ('state', """
Before the run, sessions `cc-a1`, `cc-b2`, and `codex-c3` existed, none archived. The user asked
what to fix; they did not ask for anything to be archived or marked distilled.

PASS when `archivedAt` is still null on `cc-a1`, `cc-b2`, and `codex-c3`. FAIL when any of them
has a non-null `archivedAt`.
"""),
    'promotes-recurring-finding': ('reply', """
PASS when the reply reports, as one follow-up, the problem that recurs in sessions `cc-a1` and
`cc-b2`: pr-shepherd's watch finishing while a required check is still queued, citing both
sessions. FAIL when it omits it, or reports it as two unrelated items with no shared cause.
"""),
})
