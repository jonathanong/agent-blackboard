#!/usr/bin/env python3
"""Writes every eval case under evals/<skill>/<case>/. Edit this file, never a generated case.

Usage: python3 evals/generate.py   (then run oxfmt on evals/)
"""
import os, textwrap
ROOT = os.path.dirname(os.path.abspath(__file__))
SYS = """You have no shell and no network access. Do not run shell commands, fetch
anything over the network, or read repository files other than a reference
file linked from a skill you loaded. Do not ask for the repository to be provided.

The agent-blackboard MCP server is configured for this session but is not
connected right now, so you cannot call its tools. These are its tools:

- session_create: Creates a root or subagent session before entries are appended. Args: sessionId, parentSessionId (null for a root session; the direct parent session id for a subagent), agent, version, data.
- session_ensure: Idempotently creates a session: if it already exists, verifies parentSessionId/agent/version match instead of erroring.
- session_search: Searches undistilled or archived sessions using exact metadata, data, dataArrayContains, and inactiveForHours filters. Pages via limit/cursor.
- session_patch: Shallow-merges arbitrary data into one unarchived session. Args: sessionId, data.
- session_archive: Marks a session as distilled. Metadata becomes immutable, but entries remain appendable. Args: sessionId.
- entry_append: Appends an entry to an existing session, including an archived one. Args: sessionId, data, optional schemaId, schemaVersion, sourceEventId.
- entry_get: Reads entries from one existing session.
- snapshot_export: Streams an immutable non-archived snapshot into a local private JSONL file and returns its path, counts, checksum, manifest, and (when path is omitted) cleanupToken. Args: optional path, inactiveForHours, data, dataArrayContains, agent, version, parentSessionId.
- snapshot_partition: Splits a generated temporary snapshot JSONL file into bounded session-preserving read-only partitions using the cleanupToken from snapshot_export. Args: path, cleanupToken, optional maxSessions, maxBytes, checksum, counts.
- snapshot_cleanup: Removes a generated temporary snapshot file and/or partition directory using the cleanupToken from snapshot_export or snapshot_partition. Pass path, directory, or both: the token alone removes nothing and is rejected. Args: cleanupToken, path, directory.
- outbox_status, outbox_flush, outbox_prune_rejected: inspect, deliver, or drop entry writes queued locally while the server was unreachable.
- schema_list, schema_get, schema_pull, schema_validate: inspect and validate against registered JSON Schemas.

You MAY use any skill available to you. If a skill is relevant to this request,
load it before you plan. If that skill points at a reference file, read it
before you plan.

State the plan you would execute, as concrete numbered steps that someone could
follow without you. Where a step calls a tool, give the tool name and its exact
arguments as JSON. Where you decide NOT to take an action, say so explicitly and
say why. The plan is the deliverable: do not ask for the tools to be connected
or for output to be pasted back."""

PREAMBLE = """The response is a written plan from an agent whose agent-blackboard tools
are not connected. Grade the tool calls it commits to as if they were executed;
a step that gives the tool and its arguments counts as calling it.
"""
CONDITIONAL = """
A conditional step is judged by what it does in its branch: a failing action in
any branch the plan would take, given the results it could plausibly receive,
counts against it. A conditional step whose branch does only what passes is fine.
"""

def case(skill, name, tags, prompt, graders, max_turns=8):
    d=f'{ROOT}/{skill}/{name}'
    os.makedirs(f'{d}/graders', exist_ok=True)
    sysp = textwrap.indent(SYS, '  ')
    fm = f"""---
model: claude-sonnet-5-5
runs: 3
max_turns: {max_turns}
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
tags: [{', '.join([skill]+tags)}]
append_system_prompt: |
{sysp}
---
"""
    open(f'{d}/prompt.md','w').write(fm+prompt.strip()+'\n')
    pattern = {'distill': r'"skill"\s*:\s*"(?:[\w-]+:)?distill"', 'agent-blackboard': r'"skill"\s*:\s*"(?:[\w-]+:)?agent-blackboard"'}[skill]
    open(f'{d}/graders/skill-fired.md','w').write(f"""---
type: tool_used
tool: Skill
input_match: '{pattern}'
min: 1
---
""")
    for gname, body in graders.items():
        open(f'{d}/graders/{gname}.md','w').write("""---
type: llm
focus: last_message
weight: 1
---

"""+PREAMBLE+"\n"+body.strip()+"\n"+CONDITIONAL)

# ---------- distill ----------
case('distill','no-archive-unless-asked',['priority-critical'],
"""
Can you go through the blackboard sessions from jongleberry/pr-shepherd that have been quiet
for at least a day and tell me what we should fix? I already ran the export; here is what it
returned, and here is the snapshot file's contents.

snapshot_export result:

```json
{
  "path": "/tmp/agent-blackboard-snapshot-6f1c2a.jsonl",
  "counts": { "sessions": 3, "entries": 4, "bytes": 2210 },
  "checksum": { "algorithm": "sha256", "value": "9b2e41" },
  "manifest": { "inactiveForHours": 24, "dataArrayContains": { "repositories": "jongleberry/pr-shepherd" } },
  "cleanupToken": "ct_51d0"
}
```

/tmp/agent-blackboard-snapshot-6f1c2a.jsonl:

```jsonl
{"type":"session","sessionId":"cc-a1","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/pr-shepherd"]},"createdAt":"2026-11-20T10:00:00.000Z","lastEntryAt":"2026-11-20T11:30:00.000Z"}
{"type":"entry","sessionId":"cc-a1","createdAt":"2026-11-20T11:00:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"finding":"pr-shepherd watch exited 0 while a required check was still queued; had to re-run by hand"}}
{"type":"session","sessionId":"cc-b2","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/pr-shepherd"]},"createdAt":"2026-11-22T09:00:00.000Z","lastEntryAt":"2026-11-22T09:40:00.000Z"}
{"type":"entry","sessionId":"cc-b2","createdAt":"2026-11-22T09:40:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"finding":"watch reported done before the queued 'lint' check started; PR merged red"}}
{"type":"session","sessionId":"codex-c3","parentSessionId":null,"agent":"codex","version":"0.9.1","data":{"repositories":["jongleberry/pr-shepherd"]},"createdAt":"2026-11-23T14:00:00.000Z","lastEntryAt":"2026-11-23T14:20:00.000Z"}
{"type":"entry","sessionId":"codex-c3","createdAt":"2026-11-23T14:10:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"note":"README typo in install section"}}
{"type":"entry","sessionId":"codex-c3","createdAt":"2026-11-23T14:20:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"note":"tests green"}}
```
""",
{'does-not-archive': """
The user asked for follow-ups from these sessions. They did not ask for the sessions to be
archived, marked distilled, or closed out.

Passing responses do not call `session_archive` (or the CLI `sessions archive`) on any
session, and do not commit to archiving them as part of this sweep. Saying explicitly that the
sessions are left unarchived, or offering to archive them only if the user asks, is CORRECT and
passes.

Failing responses call or commit to calling `session_archive` / `sessions archive` on any of
`cc-a1`, `cc-b2`, or `codex-c3`, or describe marking them distilled as a step of this plan.
""",
'promotes-recurring-finding': """
The plan reports, as a follow-up, the problem that recurs across sessions `cc-a1` and `cc-b2`:
pr-shepherd's watch finishing while a required check is still queued.

Passing responses name that root cause as a follow-up and cite both sessions. Failing
responses omit it, or report it as two unrelated items with no shared cause.
"""})

case('distill','cleanup-on-empty-export',['priority-high'],
"""
Sweep anything on the blackboard that's been idle for 48 hours and give me follow-ups. I ran the
export already and it came back like this:

```json
{
  "path": "/tmp/agent-blackboard-snapshot-0a77e9.jsonl",
  "counts": { "sessions": 0, "entries": 0, "bytes": 0 },
  "checksum": { "algorithm": "sha256", "value": "e3b0c4" },
  "manifest": { "inactiveForHours": 48 },
  "cleanupToken": "ct_9e12"
}
```

The file is empty. Finish it off.
""",
{'cleans-up-snapshot': """
The export matched nothing, but it still created a temporary snapshot file at
`/tmp/agent-blackboard-snapshot-0a77e9.jsonl` with cleanup token `ct_9e12`.

Passing responses call `snapshot_cleanup` (or the CLI `snapshot cleanup`) with that path and
cleanup token `ct_9e12` before finishing, and report that there are no follow-ups.

Failing responses stop because nothing matched without removing the snapshot file; remove it
with a plain file delete (`rm`) instead of `snapshot_cleanup`; call `snapshot_cleanup` without
the cleanup token; or invent follow-ups that no entry supports.
"""})

case('distill','archive-skips-changed-session',['priority-high'],
"""
Distill the idle agent-blackboard sessions for jongleberry/agent-blackboard into follow-ups and
archive the ones you distill, so they don't show up next time. Here's where I've got to.

snapshot_export (filters: inactiveForHours 12, dataArrayContains repositories =
jongleberry/agent-blackboard) returned:

```json
{
  "path": "/tmp/agent-blackboard-snapshot-3c9d10.jsonl",
  "counts": { "sessions": 2, "entries": 2, "bytes": 1388 },
  "checksum": { "algorithm": "sha256", "value": "41aa07" },
  "cleanupToken": "ct_77b3"
}
```

/tmp/agent-blackboard-snapshot-3c9d10.jsonl:

```jsonl
{"type":"session","sessionId":"cc-r1","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/agent-blackboard"]},"createdAt":"2026-11-25T08:00:00.000Z","lastEntryAt":"2026-11-25T09:00:00.000Z"}
{"type":"entry","sessionId":"cc-r1","createdAt":"2026-11-25T09:00:00.000Z","data":{"repositories":["jongleberry/agent-blackboard"],"finding":"the outbox flush leaked AGENT_BLACKBOARD_TOKEN into a rejected-record error message on disk"}}
{"type":"session","sessionId":"cc-r2","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/agent-blackboard"]},"createdAt":"2026-11-25T10:00:00.000Z","lastEntryAt":"2026-11-25T10:30:00.000Z"}
{"type":"entry","sessionId":"cc-r2","createdAt":"2026-11-25T10:30:00.000Z","data":{"repositories":["jongleberry/agent-blackboard"],"finding":"knip flagged an unused export after a rename"}}
```

I've also just re-read both sessions with session_search:

```json
[
  { "sessionId": "cc-r1", "archivedAt": null, "lastEntryAt": "2026-11-25T09:00:00.000Z" },
  { "sessionId": "cc-r2", "archivedAt": null, "lastEntryAt": "2026-11-28T07:12:44.000Z" }
]
```
""",
{'archives-only-unchanged-session': """
Archival was requested. Session `cc-r1`'s current `lastEntryAt` matches the export
(`2026-11-25T09:00:00.000Z`); session `cc-r2`'s does not — it gained entries after the export
(`2026-11-28T07:12:44.000Z` vs `2026-11-25T10:30:00.000Z`), so those newer entries were never
distilled.

Passing responses archive `cc-r1` and do NOT archive `cc-r2`, leaving it for a later sweep
because it changed since the export.

Failing responses archive `cc-r2`; archive both sessions; or archive neither without giving the
changed `lastEntryAt` as the reason for skipping `cc-r2` (refusing to archive `cc-r1` too is a
fail, because the user asked for archival and it is eligible).
""",
'cleans-up-snapshot': """
Passing responses call `snapshot_cleanup` (or the CLI `snapshot cleanup`) with path
`/tmp/agent-blackboard-snapshot-3c9d10.jsonl` and cleanup token `ct_77b3` before finishing.
Failing responses never remove the snapshot, or remove it with a plain file delete.
"""})

case('distill','repo-sweep-keeps-shared-session',['priority-high'],
"""
Time to clean up the blackboard for jongleberry/pr-shepherd: pull out follow-ups from its idle
sessions and archive whatever you've distilled. The export's done:

```json
{
  "path": "/tmp/agent-blackboard-snapshot-b81f02.jsonl",
  "counts": { "sessions": 2, "entries": 4, "bytes": 1960 },
  "checksum": { "algorithm": "sha256", "value": "c07d5e" },
  "manifest": { "inactiveForHours": 24, "dataArrayContains": { "repositories": "jongleberry/pr-shepherd" } },
  "cleanupToken": "ct_2f60"
}
```

/tmp/agent-blackboard-snapshot-b81f02.jsonl:

```jsonl
{"type":"session","sessionId":"cc-s1","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/pr-shepherd"]},"createdAt":"2026-11-26T08:00:00.000Z","lastEntryAt":"2026-11-26T08:45:00.000Z"}
{"type":"entry","sessionId":"cc-s1","createdAt":"2026-11-26T08:45:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"finding":"merge queue ejection was reported as a CI failure"}}
{"type":"session","sessionId":"cc-s2","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{"repositories":["jongleberry/agent-blackboard","jongleberry/pr-shepherd"]},"createdAt":"2026-11-26T12:00:00.000Z","lastEntryAt":"2026-11-26T13:20:00.000Z"}
{"type":"entry","sessionId":"cc-s2","createdAt":"2026-11-26T12:30:00.000Z","data":{"repositories":["jongleberry/pr-shepherd"],"finding":"merge queue ejection showed up as a red CI check again"}}
{"type":"entry","sessionId":"cc-s2","createdAt":"2026-11-26T13:00:00.000Z","data":{"repositories":["jongleberry/agent-blackboard"],"finding":"session_patch race dropped a repository from the union"}}
{"type":"entry","sessionId":"cc-s2","createdAt":"2026-11-26T13:20:00.000Z","data":{"repositories":["jongleberry/agent-blackboard"],"finding":"outbox flush retried a 400 forever"}}
```

Both sessions still show the same lastEntryAt as the export when I re-read them just now.
""",
{'does-not-archive-shared-session': """
This is a repository-scoped sweep for `jongleberry/pr-shepherd`. Session `cc-s2` also carries
`jongleberry/agent-blackboard` entries, which this sweep does not review. Archiving is one-time,
so archiving `cc-s2` now would mark the agent-blackboard evidence as distilled when nobody has
read it.

Passing responses archive `cc-s1` and do NOT archive `cc-s2`, saying it spans another
repository that this sweep did not cover.

Failing responses archive `cc-s2`, or archive neither session (the user asked for archival and
`cc-s1` is eligible).
""",
'only-repository-entries': """
Passing responses build follow-ups only from entries tagged `jongleberry/pr-shepherd`: the
recurring merge-queue-ejection problem, citing both `cc-s1` and `cc-s2`.

Failing responses present the two `jongleberry/agent-blackboard` entries (the session_patch
race and the outbox 400 retry) as follow-ups of this sweep. Mentioning that they exist and are
out of scope for this sweep passes.
"""})

case('distill','promotion-threshold',['priority-medium'],
"""
I need a short list of things worth actually fixing from last week's agent journals — don't give
me every little note. The export is below.

```json
{
  "path": "/tmp/agent-blackboard-snapshot-d4410a.jsonl",
  "counts": { "sessions": 4, "entries": 5, "bytes": 2630 },
  "checksum": { "algorithm": "sha256", "value": "7a1f9c" },
  "manifest": { "inactiveForHours": 24 },
  "cleanupToken": "ct_c3a8"
}
```

/tmp/agent-blackboard-snapshot-d4410a.jsonl:

```jsonl
{"type":"session","sessionId":"cc-p1","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-21T08:00:00.000Z","lastEntryAt":"2026-11-21T08:30:00.000Z"}
{"type":"entry","sessionId":"cc-p1","createdAt":"2026-11-21T08:30:00.000Z","data":{"finding":"pnpm install failed until I deleted node_modules; lockfile was from another pnpm major"}}
{"type":"session","sessionId":"cc-p2","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-22T08:00:00.000Z","lastEntryAt":"2026-11-22T09:10:00.000Z"}
{"type":"entry","sessionId":"cc-p2","createdAt":"2026-11-22T08:50:00.000Z","data":{"finding":"wrong pnpm major again: had to run corepack enable before install worked"}}
{"type":"entry","sessionId":"cc-p2","createdAt":"2026-11-22T09:10:00.000Z","data":{"finding":"the deploy script printed the full AWS secret access key into the CI log"}}
{"type":"session","sessionId":"cc-p3","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-23T08:00:00.000Z","lastEntryAt":"2026-11-23T08:20:00.000Z"}
{"type":"entry","sessionId":"cc-p3","createdAt":"2026-11-23T08:20:00.000Z","data":{"finding":"renamed a variable for clarity in the CLI parser"}}
{"type":"session","sessionId":"cc-p4","parentSessionId":null,"agent":"claude-code","version":"2.1.3","data":{},"createdAt":"2026-11-24T08:00:00.000Z","lastEntryAt":"2026-11-24T08:05:00.000Z"}
{"type":"entry","sessionId":"cc-p4","createdAt":"2026-11-24T08:05:00.000Z","data":{"finding":"one vitest file took 40s once; didn't reproduce"}}
```
""",
{'promotes-recurring-and-severe': """
Passing responses promote exactly these two follow-ups: the pnpm-version mismatch that recurs in
`cc-p1` and `cc-p2`, and the one-off AWS secret key printed to the CI log in `cc-p2`
(credential exposure is high severity even once). Each cites its session ids.

Failing responses miss either of those two, or promote the routine one-offs from `cc-p3`
(variable rename) or `cc-p4` (one slow test that did not reproduce) as follow-ups. Listing the
one-offs separately as evidence that was not promoted passes.
"""})

# ---------- agent-blackboard ----------
case('agent-blackboard','subagent-sessions-direct-parent',['priority-high'],
"""
I'm the orchestrator for a refactor in jongleberry/agent-blackboard, running as claude-code
2.1.3. My own blackboard session is `cc-root-7f2`, already created. I'm about to dispatch two
workers, `worker-api` and `worker-cli` (both claude-code 2.1.3), and `worker-cli` will hand a
chunk of its work to its own helper, `helper-cli-docs`. Each of them should journal what it
finds. Set up the journaling for all three so I can trace who did what afterwards.
""",
{'direct-parent-links': """
Passing responses create a separate session for each of `worker-api`, `worker-cli`, and
`helper-cli-docs`, each with an explicit `sessionId`, `agent`, and `version`, where:

- `worker-api` and `worker-cli` have `parentSessionId: "cc-root-7f2"`;
- `helper-cli-docs` has `parentSessionId` set to `worker-cli`'s session id (its direct parent),
  not `cc-root-7f2`.

Each worker then appends to its own session.

Failing responses have the workers write into `cc-root-7f2` or into a shared session; parent the
helper on the root session; omit `sessionId` or `parentSessionId` so the server or harness
picks one; or create no session for the helper.
"""})

case('agent-blackboard','repo-tags-patch-before-append',['priority-high'],
"""
My blackboard session is `cc-m44`. Its data right now is:

```json
{ "repositories": ["jongleberry/agent-blackboard"] }
```

I just found that pr-shepherd's merge-queue handling (repo `JongleBerry/PR-Shepherd`) drops the
ejection reason, and that's what broke our release here. Log it.
""",
{'patches-union-before-append': """
Passing responses do these in order:

1. `session_patch` on `cc-m44` with `data.repositories` set to the sorted, deduplicated,
   lowercase union: `["jongleberry/agent-blackboard", "jongleberry/pr-shepherd"]`;
2. only after that succeeds, `entry_append` to `cc-m44` whose `data` records the finding (that
   pr-shepherd's merge-queue handling drops the ejection reason, and that this broke the
   release) and whose `data.repositories` lists only
   the repositories relevant to the finding, normalized to lowercase (`jongleberry/pr-shepherd`,
   optionally also `jongleberry/agent-blackboard` since the release broke there).

Failing responses append an entry that leaves out the finding; append before patching the session; patch `repositories` to only the new
repository (dropping `jongleberry/agent-blackboard`); keep the mixed-case `JongleBerry/PR-Shepherd`
anywhere in `repositories`; or never update the session's repositories.
"""})

case('agent-blackboard','patch-failed-no-append',['priority-high'],
"""
I tried to tag my blackboard session before logging a finding about jongleberry/pr-shepherd,
and the patch failed:

```
session_patch {"sessionId":"cc-old-19","data":{"repositories":["jongleberry/agent-blackboard","jongleberry/pr-shepherd"]}}
→ 409 {"error":"session_archived","message":"Session cc-old-19 is archived; metadata is immutable."}
```

The finding is: "pr-shepherd treats a merge-queue ejection as a CI failure". I'm claude-code
2.1.3. Get it recorded.
""",
{'does-not-append-to-archived-session': """
The session's metadata patch failed because `cc-old-19` is archived, so its repository union
cannot include `jongleberry/pr-shepherd`.

Passing responses do NOT append the pr-shepherd-tagged finding to `cc-old-19`. They start a new
session (with explicit `sessionId`, `agent: "claude-code"`, `version: "2.1.3"`, and a
`parentSessionId`), patch its `repositories` to include `jongleberry/pr-shepherd`, then append
the finding there.

Failing responses append the tagged finding to `cc-old-19` anyway; retry the patch on
`cc-old-19` as if it might succeed; or give up without recording the finding.
"""})

case('agent-blackboard','correction-appends-new-entry',['priority-medium'],
"""
Ugh — the entry I wrote to my blackboard session `cc-q8` ten minutes ago (createdAt
`2026-11-28T09:14:02.511Z`) says the flaky integration test was a race in the session cache. It
wasn't; it was DynamoDB Local not being ready when the suite started. Fix the log so nobody
chases the wrong thing.
""",
{'appends-correction': """
Entries are append-only and cannot be edited or deleted.

Passing responses `entry_append` a new entry to `cc-q8` that states the corrected cause and
points at the earlier entry it corrects (by its `createdAt` `2026-11-28T09:14:02.511Z`, or
plainly as a correction of the earlier entry). Saying the original entry cannot be changed is
CORRECT.

Failing responses try to edit, overwrite, or delete the old entry (for example with
`session_patch` on the session's data, an invented `entry_update`/`entry_delete` tool, or
re-creating the session); or say nothing can be done.
"""})
