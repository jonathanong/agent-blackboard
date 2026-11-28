# Journaling eval history

Newest first. Each entry names the commit, models, attempts per arm, and cost.

## 2026-11-28: suite created

The `agent-journaling` plugin and these fourteen cases were added. The triggers come from a
read-only export of the hosted blackboard (434 sessions, 10,331 entries; deleted after reading):
sandbox and setup friction was the largest class, then CI and unclear test failures, then
corrections, with docs ambiguity rare. Only about 100 entries held a recommendation that named
a location, and repeats across sessions were common, which is what `journal-recall` is for. No
case copies text from those entries.
