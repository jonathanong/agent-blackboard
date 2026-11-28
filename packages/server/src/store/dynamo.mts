import type {
  AppendedSessionEntry,
  CredentialRecord,
  SchemaBundle,
  SchemaShadowReport,
  Session,
  SessionEntry,
} from '../core/types.mjs'
import type { DynamoStoreOptions } from './dynamo-client.mjs'
import { resolveDynamoConfig } from './dynamo-client.mjs'
import {
  dynamoCreateCredential,
  dynamoDeleteCredential,
  dynamoGetCredentialById,
  dynamoListCredentials,
} from './dynamo-credentials.mjs'
import { dynamoAppendEntry, dynamoGetEntries } from './dynamo-entries.mjs'
import {
  dynamoGetSchema,
  dynamoGetSchemaBundle,
  dynamoGetSchemaRegistryRevision,
  dynamoListSchemaVersions,
  dynamoListSchemas,
} from './dynamo-schemas-read.mjs'
import { dynamoPromoteSchemaVersion } from './dynamo-schemas-promote.mjs'
import {
  dynamoGetSchemaShadowReport,
  dynamoRecordSchemaShadowFailure,
} from './dynamo-schemas-shadow.mjs'
import { dynamoDeprecateSchema, dynamoPutSchemaVersion } from './dynamo-schemas-write.mjs'
import { dynamoListSessions } from './dynamo-session-list.mjs'
import { dynamoPatchSession } from './dynamo-session-patch.mjs'
import { dynamoArchiveSession, dynamoCreateSession, dynamoGetSession } from './dynamo-sessions.mjs'
import type {
  BlackboardStore,
  CredentialIdOrName,
  DeprecateSchemaResult,
  GetEntriesOptions,
  GetSchemaResult,
  GetSchemaShadowReportOptions,
  ListSchemaVersionsResult,
  ListSchemasResult,
  ListSessionsQuery,
  ListSessionsResult,
  NewSession,
  NewSessionEntry,
  PromoteSchemaVersionResult,
  PutSchemaVersionInput,
  PutSchemaVersionResult,
  RecordSchemaShadowFailureInput,
  SessionPatch,
} from './store.mjs'

export type { DynamoStoreOptions } from './dynamo-client.mjs'

/** DynamoDB-backed single-table store for credentials, sessions, entries, and schemas. */
export function createDynamoStore(options: DynamoStoreOptions = {}): BlackboardStore {
  const { doc, tableName, retention, now } = resolveDynamoConfig(options)
  return {
    createSession(input: NewSession): Promise<Session> {
      return dynamoCreateSession(doc, tableName, now, input)
    },
    getSession(credId: string, sessionId: string): Promise<Session | undefined> {
      return dynamoGetSession(doc, tableName, credId, sessionId)
    },
    listSessions(credId: string, query?: ListSessionsQuery): Promise<ListSessionsResult> {
      return dynamoListSessions(doc, tableName, credId, query, now())
    },
    patchSession(credId: string, patch: SessionPatch): Promise<Session> {
      return dynamoPatchSession(doc, tableName, credId, patch)
    },
    archiveSession(credId: string, sessionId: string): Promise<Session> {
      return dynamoArchiveSession(doc, tableName, now, credId, sessionId)
    },
    appendEntry(entry: NewSessionEntry): Promise<AppendedSessionEntry> {
      return dynamoAppendEntry(doc, tableName, retention, now, entry)
    },
    getEntries(
      credId: string,
      sessionId: string,
      options?: GetEntriesOptions,
    ): AsyncIterable<SessionEntry> {
      return dynamoGetEntries(doc, tableName, credId, sessionId, options)
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
    getSchemaRegistryRevision(): Promise<number> {
      return dynamoGetSchemaRegistryRevision(doc, tableName)
    },
    putSchemaVersion(input: PutSchemaVersionInput): Promise<PutSchemaVersionResult> {
      return dynamoPutSchemaVersion(doc, tableName, now, input)
    },
    promoteSchemaVersion(
      id: string,
      version: number,
      actor: string,
    ): Promise<PromoteSchemaVersionResult> {
      return dynamoPromoteSchemaVersion(doc, tableName, now, id, version, actor)
    },
    deprecateSchema(id: string, actor: string): Promise<DeprecateSchemaResult> {
      return dynamoDeprecateSchema(doc, tableName, now, id, actor)
    },
    listSchemas(): Promise<ListSchemasResult> {
      return dynamoListSchemas(doc, tableName)
    },
    getSchema(id: string, version?: number): Promise<GetSchemaResult | undefined> {
      return dynamoGetSchema(doc, tableName, id, version)
    },
    listSchemaVersions(id: string): Promise<ListSchemaVersionsResult | undefined> {
      return dynamoListSchemaVersions(doc, tableName, id)
    },
    getSchemaBundle(): Promise<SchemaBundle> {
      return dynamoGetSchemaBundle(doc, tableName)
    },
    recordSchemaShadowFailure(input: RecordSchemaShadowFailureInput): Promise<void> {
      return dynamoRecordSchemaShadowFailure(doc, tableName, retention.ttlDays, now, input)
    },
    getSchemaShadowReport(
      id: string,
      options?: GetSchemaShadowReportOptions,
    ): Promise<SchemaShadowReport | undefined> {
      return dynamoGetSchemaShadowReport(doc, tableName, id, options)
    },
  }
}
