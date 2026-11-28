# Journaling eval history

Newest first. Each entry names the commit, models, attempts per arm, and cost.

## 2026-11-28: tool-friction loading fixed, two cases re-measured

Commit `90f7653`, agent `claude-sonnet-5-5`, judge Opus, six attempts per arm.
`journal-tool-friction/sandbox-cache-denied` $3.56 ($0.75 agent, $2.81 judges);
`journal-dev-setup/missing-database-step` $4.53 ($0.92 agent, $3.61 judges).

- Changed: the `journal-tool-friction` description now names sandbox denials (EACCES, read-only
  file system, blocked network), and `journal-dev-setup`'s sends them there. In the run below, two
  of three tool-friction attempts had loaded `journal-dev-setup` for a sandbox EACCES.
- `sandbox-cache-denied`: loaded 6 of 6 (was 1 of 3); passed 6 of 6, baseline 0 of 6.
- `missing-database-step`: loaded 6 of 6, passed 6 of 6, baseline 0 of 6, so the narrower
  dev-setup description did not cost its own case.
- A run with two `--case` flags ran only the last one, so each case was run on its own.

## 2026-11-28: first measured run

Commit `e349bb1`, agent `claude-sonnet-5-5`, judge Opus (three votes), three attempts per arm.
Cost $20.85: $4.94 agent, $15.91 judges.

- With skills: 39 of 39 attempts passed across the 13 cases. Baseline: 0 of 3 on ten cases, 3 of
  3 on `reuse-known-fix`, `uses-registered-schema`, and `no-journal-for-red-green` (ceiling).
- Loading: 3 of 3 everywhere except `journal-tool-friction` (1 of 3, see above) and
  `journal/redacts-secret` (2 of 3). The attempt that missed loaded `journal-ci-failure` and
  `journal-recall` but never `journal`, so it did not read the no-secrets rule; it still left the
  token out and passed. Trigger skills tell the agent to use `journal`, and one in three did not.
- The baseline journals some friction unprompted when the session id is in front of it (slow
  loop, tool friction, lost context), as a one-line `learning` entry with no recommendation.

## 2026-11-28: pilot, two graders fixed

Commit before `e349bb1`, one attempt per arm, $5.09. Not comparable with later runs.

- `ci-only-date-test` failed in the with-skill arm, because the fixture was wrong: the pasted
  code returned 3 in both time zones, as the agent worked out. The dates now cross the
  2026-11-01 DST change (checked with node: 3 in America/Los_Angeles, 2 in UTC).
- `reuse-known-fix` failed `links-earlier-entry` on a plan that linked the earlier entry: the
  grader's conditional rule counted the skill's "if no tools, say what you would have written"
  fallback as a branch that writes no entry. The preamble now says that fallback does not count.
- The baseline passed the slow-loop and tool-friction cases by journaling with no
  recommendation, so those two cases and `resume-without-notes` gained a grader for a
  recommendation with a location, which the `journal` skill requires.

## 2026-11-28: suite created

The `agent-journaling` plugin and these thirteen cases were added. The triggers come from a
read-only export of the hosted blackboard (434 sessions, 10,331 entries; deleted after reading):
sandbox and setup friction was the largest class, then CI and unclear test failures, then
corrections, with docs ambiguity rare. Only about 100 entries held a recommendation that named
a location, and repeats across sessions were common, which is what `journal-recall` is for. No
case copies text from those entries.
