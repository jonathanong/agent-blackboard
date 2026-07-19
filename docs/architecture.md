# Architecture

## Request flow

The published package uses `fetch` to call a framework-neutral HTTP core. The same core runs behind
the local Node server and the Lambda Function URL adapter. Production storage uses DynamoDB; tests
and local development can use the in-memory store.

```mermaid
flowchart LR
    subgraph Consumers
        Agents[Autonomous agents]
        Operators[Operators]
        Apps[Library consumers]
    end

    subgraph Package["Published package: agent-blackboard"]
        CLI[CLI]
        MCP[MCP server]
        Client[TypeScript client]
    end

    Agents --> CLI
    Agents --> MCP
    Operators --> CLI
    Apps --> Client
    CLI --> Client
    MCP --> Client

    Client -->|"fetch + bearer token"| Endpoint{Configured endpoint}

    subgraph Server["Unpublished server"]
        Local[Local Node adapter]
        Lambda[Lambda Function URL adapter]
        Core[Framework-neutral HTTP core]
        Auth[Client and admin authentication]
        Store[BlackboardStore interface]
        Memory[In-memory store]
        Dynamo[DynamoDB store]
        AdminEnv[Admin credentials environment variable]

        Local --> Core
        Lambda --> Core
        Core --> Auth
        Auth --> Store
        Core --> Store
        Store --> Memory
        Store --> Dynamo
        AdminEnv --> Auth
    end

    Endpoint --> Local
    Endpoint --> Lambda

    subgraph Table["One DynamoDB table"]
        Sessions[(Session items)]
        Entries[(Entry items)]
        Credentials[(Credential items)]
    end

    Dynamo --> Sessions
    Dynamo --> Entries
    Dynamo --> Credentials
```

## Data model

One DynamoDB table stores multiple item types. There are no joins and no nested entry arrays.

| Entity     | Partition key                        | Sort key                     | Public fields                                                                  |
| ---------- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| Session    | `SESSIONS#<credentialId>`            | `SESSION#<sessionId>`        | `id`, `parentSessionId`, `agent`, `version`, `createdAt`, `archivedAt`, `data` |
| Entry      | `ENTRIES#<credentialId>#<sessionId>` | `ENTRY#<createdAt>`          | `sessionId`, `createdAt`, `data`                                               |
| Credential | internal credential partition        | internal credential sort key | `id`, `name`, `createdAt`                                                      |

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
- `agent` and `version` are required caller-supplied session metadata.
- Session `data` is unstructured JSON and patches shallow-merge it.
- Entry writes require an existing active session.
- Archiving sets `archivedAt`. Archived sessions and entries remain readable, but all writes and
  new children are blocked.

DynamoDB transactions combine the active-session condition with entry writes, preventing a write
from racing successfully with archival.

## HTTP API

| Method          | Path                    | Purpose                                               |
| --------------- | ----------------------- | ----------------------------------------------------- |
| `POST`          | `/sessions`             | Create `{ id, parentSessionId, agent, version }`      |
| `GET`           | `/sessions`             | List sessions; `archived=false` by default            |
| `GET`           | `/sessions/:id`         | Get session metadata                                  |
| `PATCH`         | `/sessions/:id`         | Patch `{ data }` or archive with `{ archived: true }` |
| `POST`          | `/sessions/:id/entries` | Append `{ data }`                                     |
| `GET`           | `/sessions/:id/entries` | Stream entries (`json`, `jsonl`, or `markdown`)       |
| `PATCH`         | `/sessions/:id/entries` | Patch `{ createdAt, data }`                           |
| `/credentials*` | admin routes            | Manage client credentials                             |

## Authentication

Client tokens use `abb_sk_<credentialId>_<secret>` and are hashed in DynamoDB. Admin tokens use
`abb_admin_<name>_<secret>` and exist only in the server's
`AGENT_BLACKBOARD_ADMIN_CREDENTIALS` environment variable. Client tokens cannot access credential
routes; admin tokens cannot access session or entry routes.

## Streaming

The store exposes entries as an `AsyncIterable`. The HTTP layer can emit JSON arrays, JSONL, or
Markdown without loading a session's entire entry history. The library defaults to incremental
JSONL parsing; the CLI relays response bytes directly.
