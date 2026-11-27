# TypeScript API

The public `agent-blackboard` package is a zero-configuration, `fetch`-based client for building
agent hosts, workflow automation, developer tools, and integrations around an Agent Blackboard
deployment.

Only exports from the package root are public:

```ts
import {
  AgentBlackboardError,
  Auth,
  Entries,
  formatError,
  Schemas,
  Sessions,
  Snapshots,
  type ClientConfig,
  type ReadRetryOptions,
  type SchemaSummary,
  type Session,
  type SessionEntry,
} from 'agent-blackboard'
```

Imports from `agent-blackboard/dist/*` or other internal paths are unsupported. The package requires
Node.js 24 or newer and uses the runtime's global `fetch`, `Response`, and Web Streams APIs.

## Installation

```sh
pnpm add agent-blackboard
```

The package does not deploy a server. Point it at a separately deployed Agent Blackboard HTTP
service.

## Client configuration

Session and entry clients accept a client credential:

```ts
interface ClientConfig {
  baseUrl: string
  token: string // abb_sk_<credentialId>_<secret>
  readRetry?: ReadRetryOptions
  onSchemaRevision?: (revision: number) => void
}

interface ReadRetryOptions {
  maxRetries?: number // defaults to 2
  initialDelayMs?: number // defaults to 100
  maxDelayMs?: number // defaults to 1000
}
```

```ts
const config = {
  baseUrl: 'https://example.lambda-url.us-east-1.on.aws',
  token: process.env.AGENT_BLACKBOARD_TOKEN!,
}

const sessions = new Sessions(config)
const entries = new Entries(config)
const snapshots = new Snapshots(config)
```

`baseUrl` may include or omit a trailing slash. Keep tokens out of source control and logs.

Set `readRetry` to opt in to bounded retries for GET requests. The client retries a fetch that
fails before it receives a response, and HTTP 408, 429, 500, 502, 503, and 504. It never retries
writes, other HTTP failures, or an interrupted response stream. Omit `readRetry` to make one
request, preserving the default behavior. All values are non-negative integers; retries are capped
at 10 and delays at 60 seconds.

## Complete example

```ts
import { Entries, Sessions } from 'agent-blackboard'

const config = {
  baseUrl: process.env.AGENT_BLACKBOARD_URL!,
  token: process.env.AGENT_BLACKBOARD_TOKEN!,
}

const sessions = new Sessions(config)
const entries = new Entries(config)

await sessions.create({
  id: 'root-123',
  parentSessionId: null,
  agent: 'my-agent',
  version: '1.4.0',
})

await sessions.patch({
  sessionId: 'root-123',
  data: { repository: 'example/tooling', branch: 'main' },
})

await entries.append({
  sessionId: 'root-123',
  data: {
    type: 'finding',
    summary: 'Retries can race with archival.',
  },
})

await entries.append({
  sessionId: 'root-123',
  data: { type: 'finding-update', reproduced: true },
})

for await (const entry of entries.get({ sessionId: 'root-123' })) {
  console.log(entry)
}

await sessions.archive('root-123')
```

All session ids, parent relationships, agent names, and versions come from the caller. The service
generates timestamps only. To resolve an id from a harness environment, use
`resolveSessionIdentity`. See [session-id resolution](session-id-resolution.md).

## `Sessions`

Create one instance with `new Sessions(config: ClientConfig)`.

### `create(input): Promise<Session>`

```ts
interface CreateSessionInput {
  id: string
  parentSessionId: string | null
  agent: string
  version: string
}
```

Creates a root session when `parentSessionId` is `null`, or a child session when it contains the
direct parent's id. A parent must exist and belong to the same credential; archived parents remain
valid. Session ids
must contain only letters, numbers, `.`, `_`, `:`, and `-`. Creating an existing id fails rather
than replacing it.

### `get(sessionId): Promise<Session>`

Returns one session, including archived sessions. A missing session rejects with
`AgentBlackboardError` status `404`.

### `list(query?): Promise<Session[]>`

```ts
interface ListSessionsQuery {
  archived?: boolean
  inactiveForHours?: number
}
```

- `list()` and `list({ archived: false })` return undistilled sessions.
- `list({ archived: true })` returns archived sessions.
- `inactiveForHours` must be positive and matches sessions whose `lastEntryAt` is strictly older
  than the service-calculated cutoff. A session without entries is treated as last active at its
  `createdAt`.

The method buffers the returned session list in memory.

### `patch(input): Promise<Session>`

```ts
interface PatchSessionInput {
  sessionId: string
  data: Record<string, unknown>
}
```

Shallow-merges a non-empty `data` object into an unarchived session. Top-level keys are merged; a
nested object replaces the previous value at that key. Identity, parent, agent, version, and
timestamps are not patchable.

### `archive(sessionId): Promise<Session>`

Sets `archivedAt` and returns the complete session. Archival is idempotent: archiving an already
archived session preserves its original `archivedAt`.

Archival is the one-time distillation marker. Archived sessions and their entries remain readable,
entry appends remain allowed, and new children may reference an archived parent. Session metadata
patches and further retrospective/distillation passes are rejected.

### `Session`

```ts
interface Session {
  id: string
  parentSessionId: string | null
  agent: string
  version: string
  createdAt: string
  lastEntryAt: string | null
  archivedAt: string | null
  data: Record<string, unknown>
}
```

`createdAt`, non-null `lastEntryAt`, and non-null `archivedAt` are ISO 8601 timestamps generated by
the service. `lastEntryAt` is `null` until the first append and advances monotonically thereafter.

## `Entries`

Create one instance with `new Entries(config: ClientConfig)`.

### `append(input): Promise<AppendEntryResult>`

```ts
interface AppendEntryInput {
  sessionId: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
}
```

Appends one entry to any existing session, including an archived one. When `schemaId` (and optional
`schemaVersion`) is supplied, the server validates `data` against that registered JSON Schema and
stores the resolved `schemaId` and `schemaVersion` on the entry. The service assigns `createdAt`,
advances the session's `lastEntryAt`, and leaves `archivedAt` unchanged; the caller cannot supply or
override timestamps.

### `get(query): AsyncIterable<SessionEntry>`

```ts
type StructuredEntryFormat = 'json' | 'jsonl'

interface GetEntriesQuery {
  sessionId: string
  format?: StructuredEntryFormat
}
```

Returns an async iterable. Consume it with `for await...of`:

```ts
for await (const entry of entries.get({ sessionId: 'root-123' })) {
  console.log(entry)
}
```

The default format is `jsonl`, parsed incrementally as bytes arrive. Selecting `json` buffers the
server's full JSON array before yielding entries. Archived-session entries remain readable. The
HTTP request starts when iteration begins, so streaming and HTTP errors may be thrown from the
`for await...of` loop rather than the call to `get()`.

Markdown is an HTTP/CLI representation, not a structured `Entries.get()` format. The package also
exports the broader `EntryWireFormat` and `GetRawEntriesQuery` types for adapter authors, but it does
not export a raw-response entry method. Use the documented HTTP API when an integration needs raw
Markdown bytes.

Entries are append-only: there is no method to modify an entry's `data` in place. To record an
update, append a new entry.

## `Snapshots`

Create one instance with `new Snapshots(config: ClientConfig)`.

### `export(options?): Promise<SnapshotExportResult>`

```ts
const result = await snapshots.export({
  path: '/absolute/path/evidence.jsonl',
  selection: { parentSessionId: null, inactiveForHours: 8 },
})
```

Streams each selected unarchived session and its entries directly to a new file. Omit `path` to
create a unique file under the system temporary directory. A supplied path must be absolute and
must not exist. `selection` supports exact `agent`, `version`, `parentSessionId`, and shallow
`data` filters plus positive `inactiveForHours`.

The method incrementally validates the JSONL records and terminal manifest, computes a SHA-256
checksum over the exact file bytes, syncs the file, and changes it from private writable mode to
read-only mode. It deletes incomplete output on any failure. Generated temporary exports also return
a random `cleanupToken`; explicit `path` destinations do not receive one and remain caller-owned.
The returned object contains only the path, session/entry/record/byte counts, checksum, manifest,
and (for generated exports) capability; it never buffers or returns all snapshot evidence.

### `partition(options): Promise<SnapshotPartitionResult>` and `cleanup(options): Promise<void>`

```ts
const result = await snapshots.partition({
  path: exported.path,
  cleanupToken: exported.cleanupToken,
  checksum: exported.checksum,
  counts: exported.counts,
})
await snapshots.cleanup({
  path: exported.path,
  directory: result.directory,
  cleanupToken: result.cleanupToken,
})
```

Partitioning only accepts a generated temporary export path and its cleanup capability. It verifies the source's complete
schema-1 manifest, optionally verifies the caller's checksum and counts, and emits private
read-only JSONL files with their own terminal manifests. Sessions and their ordered entries remain
whole and contiguous. The defaults are 25 sessions and 1 MiB per partition; a session that cannot
fit is rejected. Cleanup accepts either generated artifact or both. Explicit absolute export
destinations stay caller-owned and cannot be partitioned or cleaned up. The cleanup capability is
required for cross-process CLI use; library calls in the same process may reuse the generated
artifact's tracked capability.

The generated names, private modes, capability, and identity checks reject substitutions visible at
each operation boundary. This pure-Node implementation cannot defend against a malicious concurrent
process running as the same operating-system user that swaps a pathname between those checks; do not
use these temporary artifacts across mutually untrusted same-UID processes.

### `SessionEntry`

```ts
interface SessionEntry {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
  schemaId?: string
  schemaVersion?: number
}

interface AppendEntryResult extends SessionEntry {
  warning?: SchemaShadowWarning // present when accepted under per-version or global shadow mode
}
```

`data` is JSON-serializable object data; when validated against a registered schema, `schemaId` and
`schemaVersion` record the exact immutable schema version used at write time. Avoid `undefined`,
functions, symbols, `BigInt`, circular references, and other non-JSON values.

## `Schemas`

`Schemas` exposes read operations plus local pull and offline validation against the JSON Schema
2020-12 registry. Admin operations (`put`, `promote`, `report`, `remove`) are CLI/admin-only and
are not exported here.

```ts
interface LocalSchemaOptions {
  dir?: string // explicit cache directory override
  cwd?: string // base directory for worktree-root lookup; defaults to process.cwd()
  env?: NodeJS.ProcessEnv // checked for AGENT_BLACKBOARD_SCHEMAS_DIR; defaults to {}
}

const schemas = new Schemas(config)

const { revision, schemas: summaries } = await schemas.list()
const latest = await schemas.get('finding')
const pinned = await schemas.get('finding', 1)
const history = await schemas.listVersions('finding')

const pull = await schemas.pull({ dir: '/path/to/cache' })
const result = schemas.validateLocal('finding', { title: 'flaky retry' }, { dir: pull.dir })
```

`LocalSchemaOptions.env` defaults to `{}` rather than reading `process.env` implicitly.
`validateLocal` and `validateAgainstLocalSchemas` throw when no valid local pull exists, when the
requested schema or version is missing, or when the schema is deprecated; schema validation
failures return `{ valid: false, schema, revision, errors }` instead of throwing.

Pure helpers `resolveSchemasDir`, `validateAgainstBundle`, and `validateAgainstLocalSchemas` are
also exported from the package root for offline workflows.

## `Auth`

`Auth` manages client credentials and requires an admin credential. Never give an admin token to an
agent or MCP server.

```ts
interface AuthOptions {
  baseUrl: string
  adminToken: string // abb_admin_<name>_<secret>
}

const auth = new Auth({
  baseUrl: process.env.AGENT_BLACKBOARD_URL!,
  adminToken: process.env.AGENT_BLACKBOARD_ADMIN_TOKEN!,
})
```

### `createCredentials(input): Promise<CredentialCreated>`

```ts
const credential = await auth.createCredentials({ name: 'ci-agent' })
```

Returns `{ id, name, createdAt, token }`. The raw client token is returned only once; store it
securely.

### `listCredentials(): Promise<CredentialSummary[]>`

Returns `{ id, name, createdAt }[]`. Tokens and token hashes are never included.

### `deleteCredentials(selector): Promise<void>`

```ts
await auth.deleteCredentials({ id: credential.id })
await auth.deleteCredentials({ name: 'obsolete-agent' })
```

Deletion by id targets one credential. Names are not unique, so deletion by name removes every
matching credential.

## Errors

Every non-2xx HTTP response rejects with `AgentBlackboardError`:

```ts
import { AgentBlackboardError } from 'agent-blackboard'

try {
  await sessions.get('missing')
} catch (error) {
  if (error instanceof AgentBlackboardError) {
    console.error(error.status) // HTTP status
    console.error(error.body) // parsed JSON, raw text, or undefined
  }
}
```

```ts
class AgentBlackboardError extends Error {
  readonly status: number
  readonly body: unknown
}
```

Network failures, invalid JSON responses, and stream parse failures are native platform errors, not
`AgentBlackboardError`. The client does not expose timeout, abort-signal, custom `fetch`, or
middleware options. Its optional `readRetry` policy retries only safe GET transport failures and
selected transient responses; integrations must not retry non-idempotent appends blindly. Remote
client URLs must use HTTPS; HTTP is accepted only for local loopback development servers.

### `formatError(error): string`

Use `formatError` when displaying a caught value in a CLI, MCP server, or other user-facing surface.
It returns an `Error` message, or stringifies a non-`Error` thrown value. For an
`AgentBlackboardError`, it appends the parsed response body when one exists:

```ts
import { formatError } from 'agent-blackboard'

console.error(formatError(new Error('connection failed')))
// connection failed
```

An `Error` with a `cause` still formats as its own message. If a response body cannot be serialized,
the message is preserved with `[unserializable error body]`; an otherwise unprintable thrown value
formats as `[unprintable error]`. `formatError` never throws while handling an error.

## Exported API

The package root exports:

- configuration: `ClientConfig`, `ReadRetryOptions`, `AuthOptions`;
- sessions: `Session`, `CreateSessionInput`, `PatchSessionInput`, `ListSessionsQuery`;
- entries: `SessionEntry`, `AppendEntryInput`, `AppendEntryResult`, `GetEntriesQuery`,
  `GetRawEntriesQuery`, `EntryWireFormat`, `StructuredEntryFormat`;
- credentials: `CredentialCreated`, `CredentialSummary`;
- schemas: `Schemas`, `LocalSchemaOptions`, `resolveSchemasDir`, `validateAgainstBundle`,
  `validateAgainstLocalSchemas`, `SchemaSummary`, `SchemaVersionMode`, `SchemaVersionRecord`,
  `SchemaWithVersions`, `SchemaBundle`, `SchemaVersionDetail`, `ListSchemasResult`,
  `ListSchemaVersionsResult`, `PullSchemasResult`, `SchemaValidationIssue`,
  `SchemaValidationResult`, `SchemaShadowWarning`;
- snapshots: `Snapshots`, `partitionSnapshot`, `cleanupSnapshotPartitions`, `SnapshotSelection`,
  `SnapshotManifest`, `SnapshotCounts`, `SnapshotChecksum`, `SnapshotVerification`,
  `SnapshotExportOptions`, `SnapshotExportResult`, `SnapshotPartitionOptions`,
  `SnapshotPartition`, `SnapshotPartitionResult`, `SnapshotCleanupOptions`;
- errors: `AgentBlackboardError`, `formatError`.

The package is currently version `0.3.1`. Tooling should pin an exact version until a stable
compatibility policy is published.
