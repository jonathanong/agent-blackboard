# Default entry shape

Use this shape when no registered schema fits (see `SKILL.md`, step 1).

```json
{
  "sessionId": "<your session>",
  "sourceEventId": "ci-failure:jongleberry/widget:build:run-4812",
  "data": {
    "type": "journal",
    "trigger": "ci-failure",
    "repositories": ["jongleberry/widget"],
    "status": "open",
    "markdown": "CI `build` failed on 3f2a91c at `pnpm install --frozen-lockfile`: the lockfile was not updated with package.json. Not a flake: the rerun failed the same way.",
    "evidence": {
      "check": "build",
      "run": "4812",
      "commit": "3f2a91c",
      "command": "pnpm install --frozen-lockfile",
      "error": "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with \"frozen-lockfile\" because pnpm-lock.yaml is not up to date with package.json"
    },
    "cause": "package.json gained a dependency without a lockfile update",
    "recommendations": [
      {
        "where": "AGENTS.md, Conventions",
        "change": "Say to run pnpm install and commit pnpm-lock.yaml with every package.json edit",
        "why": "The same check failed twice in this session"
      }
    ],
    "references": ["package.json:12", "pnpm-lock.yaml", "PR #41", "cc-91@2026-11-20T10:02:11.000Z"]
  }
}
```

| Field             | What goes in it                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`            | Always `journal`.                                                                                                                                                   |
| `trigger`         | `ci-failure`, `unclear-failure`, `dev-setup`, `ambiguity`, `tool-friction`, `correction`, `slow-loop`, or `lost-context`, as the skill that sent you here names it. |
| `status`          | `open`, `worked-around`, or `resolved`.                                                                                                                             |
| `markdown`        | Two to six plain sentences a person can read without the other fields: what happened, the cause, and what you did.                                                  |
| `evidence`        | The facts: the first error line verbatim, the command, check, run, commit, and versions. No whole logs.                                                             |
| `cause`           | What you know, `unknown`, or a guess labelled as a guess.                                                                                                           |
| `recommendations` | One to three `{where, change, why}`.                                                                                                                                |
| `references`      | Files with lines, docs with sections, issues, PRs, and earlier entries as `<sessionId>@<createdAt>`.                                                                |
