---
name: distill
description: Use when distilling accumulated agent-blackboard sessions into concrete follow-ups, sweeping finished sessions after a time window or repository filter, or turning journal snapshots into evidence-backed action items. Exports and partitions snapshots, groups entries by root cause, archives only when asked, and always cleans up snapshot files.
---

# Distill

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

Turn finished `agent-blackboard` sessions into evidence-backed follow-ups without loading raw
snapshots across MCP or leaving temporary files behind. Filing follow-ups as tickets or issues stays
the caller's job.

## Inputs

Collect or confirm these parameters before starting:

- **Selection window**: an optional `inactiveForHours` threshold (passed to `snapshot_export`)
  and/or a `since` ISO-8601 cursor (applied to each session's `lastEntryAt ?? createdAt`).
- **Data filters**: optional repository filter (`dataArrayContains: { "repositories": "owner/name" }`
  or `data: { "repository": "owner/name" }`), plus any `agent`, `version`, or `parentSessionId`
  filter.
- **Archival flag**: `archive` (`false` by default). Never archive sessions unless the caller
  explicitly asks.
- **Partition limits**: optional `maxSessions` (default `25`) and `maxBytes` (default `1048576`).

## Procedure

Run cleanup in a `finally`-style step regardless of success, empty results, or errors.

1. **Export a generated snapshot.**
   Call `snapshot_export` **without** `path` so the tool creates a private temporary file and
   returns `{ path, counts, checksum, manifest, cleanupToken }`. Pass all requested selection
   filters (`inactiveForHours`, `data`, `dataArrayContains`, `agent`, `version`, `parentSessionId`).
   Never pass an explicit `path` if you intend to partition or clean up through MCP.

2. **Partition large exports.**
   When `counts.sessions > maxSessions` or `counts.bytes > maxBytes` — or when splitting read-only
   inspection across subagents — call `snapshot_partition` with:

   ```json
   {
     "path": "<export.path>",
     "cleanupToken": "<export.cleanupToken>",
     "maxSessions": 25,
     "maxBytes": 1048576,
     "checksum": "<export.checksum.value>",
     "counts": "<export.counts>"
   }
   ```

   Record `directory` from the response so cleanup removes both the snapshot and the partition
   directory.

3. **Filter and group entries by root cause.**
   Read each partition file (or the single snapshot file when unpartitioned) from local disk.
   - If a `since` cursor was given, keep only sessions whose `lastEntryAt ?? createdAt` is strictly
     after `since`.
   - For a repository-scoped sweep, include only entries tagged for that repository (when entries
     carry `data.repositories` or `data.repository`). Do not infer repository tags on untagged
     entries.
   - Cluster entries across root and child sessions by shared root cause, not by session or
     surface symptom.
   - Promote a group to a follow-up when it recurs in at least **2 distinct sessions**, or when a
     one-off represents high severity (data loss, credential exposure, security boundary failure,
     irreversible external mutation, or a standard-workflow blocker). Leave routine one-offs as
     unpromoted evidence.
   - Keep exact `sessionId` and `createdAt` citations; set missing fields to `null` rather than
     inventing them.

4. **Return structured follow-ups.**
   Emit follow-ups with concrete changes, evidence citations, and source session ids (see
   [output schema and subagent prompt](references/output-schema.md)). Do not file issues, edit
   source code, or append distillation output back into source sessions — return the structured
   result to the caller.

5. **Archive sessions only when asked.**
   - By default, leave every session unarchived (`archivedSessions: []`).
   - Only when the caller explicitly requested archival, re-read each eligible distilled session via
     `session_search({ "sessionId": "<id>" })`. Call `session_archive({ "sessionId": "<id>" })`
     only when its current `lastEntryAt` equals the `lastEntryAt` in the export. Otherwise skip it
     and leave it out of `archivedSessions`. Record `archivedAt` for each archived session.
   - In a repository-scoped sweep, do **not** archive a session whose `data.repositories` lists
     other repositories that were not part of this sweep.

6. **Always clean up snapshot artifacts.**
   Call `snapshot_cleanup` before returning, even if zero sessions matched or an earlier step
   failed:

   ```json
   {
     "path": "<export.path>",
     "directory": "<partition.directory-if-created>",
     "cleanupToken": "<export.cleanupToken>"
   }
   ```

   Confirm `{ "removed": true }` so no snapshot or partition files remain on disk.

## CLI fallback

When MCP is unavailable, run the identical sequence through the published CLI:

- `npx -y agent-blackboard@0.8.0 snapshot export [filters...]`
- `npx -y agent-blackboard@0.8.0 snapshot partition --path <path> --cleanup-token <token>`
- `npx -y agent-blackboard@0.8.0 sessions get <id>` and `npx -y agent-blackboard@0.8.0 sessions archive <id>` (only when explicitly asked and `lastEntryAt` still matches the export)
- `npx -y agent-blackboard@0.8.0 snapshot cleanup --path <path> [--directory <dir>] --cleanup-token <token>`
