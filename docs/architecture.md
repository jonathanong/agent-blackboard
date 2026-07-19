# Architecture

## Request flow

The published package uses `fetch` to call a framework-neutral HTTP core. The same core runs behind
the local Node server and the Lambda Function URL adapter. Production storage uses DynamoDB; tests
and local development can use the in-memory store.

## Data model

One DynamoDB table stores multiple item types. There are no joins and no nested entry arrays.

| Entity     | Partition key                        | Sort key                     | Public fields                                      |
| ---------- | ------------------------------------ | ---------------------------- | -------------------------------------------------- |
| Session    | `SESSIONS#<credentialId>`            | `SESSION#<sessionId>`        | `id`, `parentSessionId`, `createdAt`, `archivedAt` |
| Entry      | `ENTRIES#<credentialId>#<sessionId>` | `ENTRY#<createdAt>`          | `sessionId`, `createdAt`, `data`                   |
| Credential | internal credential partition        | internal credential sort key | `id`, `name`, `createdAt`                          |

Each entry is independently writable and queryable. Entry identity is `(sessionId, createdAt)`;
timestamps are allocated by the service and are collision-safe within a session. TTL is an internal
entry attribute derived from `createdAt`.

## Session invariants

- The caller supplies every session id. No layer infers or generates ids. Ids contain only letters,
  numbers, `.`, `_`, `:`, and `-`.
- A root has `parentSessionId: null`.
- A subagent creates its own session with the direct parent's id.
- Parent and child must belong to the same client credential.
- The parent must exist and be active when the child is created.
- Parent relationships are immutable.
- Entries require an existing active session.
- Archiving session metadata blocks reads, appends, patches, and new children.

DynamoDB transactions combine the active-session condition with entry writes, preventing a write
from racing successfully with archival.

## HTTP API

| Method          | Path                    | Purpose                                         |
| --------------- | ----------------------- | ----------------------------------------------- |
| `POST`          | `/sessions`             | Create `{ id, parentSessionId }`                |
| `GET`           | `/sessions`             | List sessions for the credential                |
| `GET`           | `/sessions/:id`         | Get session metadata                            |
| `PATCH`         | `/sessions/:id`         | Archive with `{ archived: true }`               |
| `POST`          | `/sessions/:id/entries` | Append `{ data }`                               |
| `GET`           | `/sessions/:id/entries` | Stream entries (`json`, `jsonl`, or `markdown`) |
| `PATCH`         | `/sessions/:id/entries` | Patch `{ createdAt, data }`                     |
| `/credentials*` | admin routes            | Manage client credentials                       |

## Authentication

Client tokens use `abb_sk_<credentialId>_<secret>` and are hashed in DynamoDB. Admin tokens use
`abb_admin_<name>_<secret>` and exist only in the server's
`AGENT_BLACKBOARD_ADMIN_CREDENTIALS` environment variable. Client tokens cannot access credential
routes; admin tokens cannot access session or entry routes.

## Streaming

The store exposes entries as an `AsyncIterable`. The HTTP layer can emit JSON arrays, JSONL, or
Markdown without loading a session's entire entry history. The library defaults to incremental
JSONL parsing; the CLI relays response bytes directly.
