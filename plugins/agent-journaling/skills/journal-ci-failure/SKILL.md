---
name: journal-ci-failure
description: Use when CI is failing or red - a required check, GitHub Actions job, or build failed on a pull request or branch - including while you fix it. Journals the failure to agent-blackboard with the check, run, commit, first error line, cause, and how to stop it recurring.
---

# Journal a CI failure

Read every applicable `AGENTS.md` first. Repository-local policy overrides these defaults.

Before you dig in, check for an earlier journal of the same failure with the `journal-recall`
skill. Then journal it with the `journal` skill, `trigger: "ci-failure"`, before you push the fix.

## When

Journal every failing CI run you look at, even when the cause is your own mistake and the fix is
one line: the pattern across runs is what someone can fix. Do not journal a run that was
cancelled because a newer push replaced it.

## What to capture

- The check or job, the run id, and the commit.
- The first error line, verbatim, and the step that printed it.
- Whether a rerun with no change passed (a flake) or failed the same way.
- The cause, or `unknown`. An outage of a third-party service is `outage: <service>`; check its
  status page with the `service-status` skill when you have it.

## Improvements to consider

- A check that catches this locally, before the push: a pre-push hook, a `pnpm lint` step, or a
  test.
- An `AGENTS.md` line for the rule CI enforced that you did not know about.
- For a flake: the test or step to stabilize, and what it depends on (time, network, order).
- For an outage: no code change. Say so.

When the failing check is a test and its error does not say why it failed, also follow
`journal-unclear-failure` in the same entry.
