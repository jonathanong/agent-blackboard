import type { CredentialRecord, TelemetryEntry } from '../core/types.mjs'
import type { DynamoStoreOptions } from './dynamo-client.mjs'
import { resolveDynamoConfig } from './dynamo-client.mjs'
import {
  dynamoCreateCredential,
  dynamoDeleteCredential,
  dynamoGetCredentialById,
  dynamoListCredentials,
} from './dynamo-credentials.mjs'
import { dynamoAppendEntries, dynamoAppendEntry, dynamoGetEntries } from './dynamo-entries.mjs'
import { dynamoPatchEntries } from './dynamo-entries-patch.mjs'
import type {
  CredentialIdOrName,
  EntryFilter,
  EntryPatch,
  TelemetryStore,
  NewTelemetryEntry,
} from './store.mjs'

export type { DynamoStoreOptions } from './dynamo-client.mjs'

/**
 * DynamoDB-backed `TelemetryStore` — single-table design (table name from
 * `ATEL_TABLE` env, default `Atel`).
 *  - Telemetry entry item: `PK = credId`, `SK = "${sessionId}#${entryId}"`
 *    (`entryId` a local ULID-style id — see `ids.mts`).
 *  - Credential item: `PK = "CRED"`, `SK = credId`.
 * See `dynamo-entries.mts` / `dynamo-credentials.mts` for the query/update
 * logic, and `dynamo-client.mts` for client + config resolution.
 */
export function createDynamoStore(options: DynamoStoreOptions = {}): TelemetryStore {
  const { doc, tableName, ttlDays, now } = resolveDynamoConfig(options)
  return {
    appendEntry(entry: NewTelemetryEntry): Promise<TelemetryEntry> {
      return dynamoAppendEntry(doc, tableName, ttlDays, now, entry)
    },
    appendEntries(entries: NewTelemetryEntry[]): Promise<TelemetryEntry[]> {
      return dynamoAppendEntries(doc, tableName, ttlDays, now, entries)
    },
    getEntries(credId: string, filter: EntryFilter): AsyncIterable<TelemetryEntry> {
      return dynamoGetEntries(doc, tableName, credId, filter)
    },
    patchEntries(credId: string, patches: EntryPatch[]): Promise<TelemetryEntry[]> {
      return dynamoPatchEntries(doc, tableName, credId, patches)
    },
    createCredential(name: string): Promise<{ record: CredentialRecord; token: string }> {
      return dynamoCreateCredential(doc, tableName, now, name)
    },
    listCredentials(): Promise<CredentialRecord[]> {
      return dynamoListCredentials(doc, tableName)
    },
    getCredentialById(id: string): Promise<CredentialRecord | undefined> {
      return dynamoGetCredentialById(doc, tableName, id)
    },
    deleteCredential(idOrName: CredentialIdOrName): Promise<boolean> {
      return dynamoDeleteCredential(doc, tableName, idOrName)
    },
  }
}
