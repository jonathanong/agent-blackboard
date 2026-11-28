# Distill output schema and subagent prompt

Read this reference when formatting the final distillation output or delegating read-only
partition inspection to parallel subagents.

## Output JSON shape

Return one JSON object to the caller:

```json
{
  "followUps": [
    {
      "title": "Imperative, owner-ready follow-up title",
      "rootCause": "Shared underlying cause across cited entries",
      "change": "Concrete change to implement",
      "benefit": "Expected outcome after the change",
      "destination": "ticket | AGENTS.md | test | lint | docs | skill",
      "severity": "high | medium | low",
      "sessions": ["root-1", "root-2"],
      "evidence": [
        {
          "sessionId": "root-1",
          "createdAt": "2026-01-01T00:10:00.000Z",
          "summary": "Concrete finding summary from the entry"
        }
      ]
    }
  ],
  "distilledSessions": ["root-1", "root-2"],
  "archivedSessions": [{ "sessionId": "root-1", "archivedAt": "2026-01-02T00:00:00.000Z" }],
  "skippedOneOffs": 1,
  "cleanedUp": true
}
```

- `followUps`: sorted with recurring and high-severity items first. Reject vague titles like
  "improve reliability".
- `archivedSessions`: always `[]` unless the caller explicitly requested archival.
- `cleanedUp`: `true` once `snapshot_cleanup` succeeds.

## Parallel partition inspection prompt

When a snapshot is split into multiple partition files, give each read-only subagent one
non-overlapping partition path:

```text
Read only this local snapshot partition JSONL file: <partition-path>.
Apply cursor filter since=<iso-or-none> and repository filter repo=<owner/name-or-none>.
Return one JSON array of candidate observations:
[{ "sessionId", "createdAt", "rootCause", "summary", "evidence", "severity", "repositories" }].
Use null for any missing field; never invent values.
Do not call session_archive, snapshot_cleanup, file tickets, or edit repository files.
```

The coordinating agent merges observations across partitions, deduplicates root causes, applies the
promotion threshold, optionally archives eligible sessions when explicitly requested, and runs
`snapshot_cleanup`.
