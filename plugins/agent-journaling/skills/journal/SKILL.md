---
name: journal
description: Use when a journal-* skill sends you here, or when something caused friction or extra thinking and you are about to record it in agent-blackboard. Covers picking the registered entry schema, a short pass on how to prevent the friction, the references to attach, and the entry itself.
---

# Journal friction

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

A journal entry records something that cost you time or extra thought, so that someone can remove
it. The `journal-*` skills say when to write one. This skill says how. Sessions, appends, and
repository tags work as the `agent-blackboard` skill describes; follow its rule to merge
`data.repositories` before you append.

Write the entry when the friction happens, before you move on. A session can end without warning,
and the details fade by the end of the task.

## 1. Pick the schema

Call `schema_list` (CLI: `agent-blackboard schemas list`) once per session, before your first
entry.

- Skip schemas with a `deprecatedAt`.
- If an id names journal entries or friction (`journal`, `friction`, `finding`, and the like),
  read it with `schema_get` and use it when its fields fit what you are recording. Fill its
  required fields, pass `schemaId` and `schemaVersion` on the append, and keep any extra field
  below only where the schema allows extra properties.
- If no schema fits, or the list is empty, append without `schemaId` in the default shape in
  [`references/entry-shape.md`](references/entry-shape.md).
- If the append is rejected for a missing or invalid schema, fix the data to match the schema the
  error names, and retry once. Do not drop fields the schema requires to get past it.

## 2. Think briefly about the fix

Ask one question: what change would have stopped this, or made it a one-minute fix? Answer from
what you have already seen. Do not start a new investigation to answer it, and do not make the
change unless it is part of your task.

Write one to three `recommendations`. Each names `where` (a file and section, a script, a check, a
tool's error message) and the `change` in one sentence. "Improve the docs" is not a
recommendation. "Add `docker compose up -d db` as step 2 of README Setup" is. If you cannot name a
location, say what you would need to know, and leave it at that.

## 3. Attach references

Put what someone needs to find the problem again in `references`, and the first error line in
`evidence.error`, copied verbatim:

- files with line numbers (`src/retry.ts:14`), docs with their section;
- the command you ran, the check or test name, the run id, and the commit;
- issues, pull requests, and earlier journal entries (`<sessionId>@<createdAt>`, from the
  `journal-recall` skill);
- the external doc or status page you used, by name.

## 4. Append

Call `entry_append` (CLI: `agent-blackboard append`) on your own session with a `sourceEventId`
of `<trigger>:<owner/name>:<stable key>`, where the key is the check and run, the test, the
command, or the file. A retry of the same append then stores nothing new.

Write one entry per distinct problem. When you later resolve it, append a second entry with
`status: "resolved"` and the real cause. Entries are append-only.

## Never

- Never write tokens, passwords, cookies, keys, email addresses, or environment dumps. Replace a
  secret in an error line with `<redacted>`, and write home directories as `~`.
- Never journal progress narration ("opened the PR", "tests pass"). Record a problem someone
  could act on, and say plainly what was not the cause when you ruled it out.
- Never let journaling block the task. If neither the MCP tools nor the CLI are available, say in
  your final message what you would have journaled, and carry on.
