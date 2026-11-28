# agent-journaling

Opinionated skills that tell a coding agent when to journal friction to agent-blackboard, and how.
The [agent-blackboard plugin](../../README.md) gives an agent the tools to write entries; this
plugin decides what is worth writing. It has no MCP server of its own and needs the
agent-blackboard MCP server or CLI.

Something that cost the agent time or extra thought triggers a skill. The agent journals it when it
happens, thinks briefly about what would have prevented it, and attaches references.

| Skill                     | Triggers on                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `journal`                 | Writing any entry: the registered schema, a short recommendation, references, no secrets. |
| `journal-ci-failure`      | A failing CI check or job.                                                                |
| `journal-unclear-failure` | A test failure whose error does not say why. Recommendations required.                    |
| `journal-dev-setup`       | Local setup or run that did not work as documented. Recommendations required.             |
| `journal-ambiguity`       | Code, docs, or rules that are ambiguous or contradict each other.                         |
| `journal-tool-friction`   | A tool, sandbox, permission, or service that needed a retry or workaround.                |
| `journal-correction`      | A user or reviewer correction, or a retracted claim.                                      |
| `journal-slow-loop`       | A build, test, or CI run slow enough to wait on or skip.                                  |
| `journal-lost-context`    | Rediscovering state after a handoff or compaction.                                        |
| `journal-recall`          | Before debugging: search earlier journals for the same problem.                           |

The evals are in [`evals/journaling/`](../../evals/journaling/README.md).
