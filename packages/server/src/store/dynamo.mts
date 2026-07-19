import type { CredentialRecord, Session, SessionEntry } from '../core/types.mjs'
import type { DynamoStoreOptions } from './dynamo-client.mjs'
import { resolveDynamoConfig } from './dynamo-client.mjs'
import {
  dynamoCreateCredential,
  dynamoDeleteCredential,
  dynamoGetCredentialById,
  dynamoListCredentials,
} from './dynamo-credentials.mjs'
import { dynamoAppendEntry, dynamoGetEntries, dynamoPatchEntry } from './dynamo-entries.mjs'
import { dynamoPatchSession } from './dynamo-session-patch.mjs'
import {
  dynamoArchiveSession,
  dynamoCreateSession,
  dynamoGetSession,
  dynamoListSessions,
} from './dynamo-sessions.mjs'
import type {
  BlackboardStore,
  CredentialIdOrName,
  EntryPatch,
  NewSession,
  NewSessionEntry,
  SessionPatch,
} from './store.mjs'

export type { DynamoStoreOptions } from './dynamo-client.mjs'

/** DynamoDB-backed single-table store for credentials, sessions, and entries. */
export function createDynamoStore(options: DynamoStoreOptions = {}): BlackboardStore {
  const { doc, tableName, ttlDays, now } = resolveDynamoConfig(options)
  return {
    createSession(input: NewSession): Promise<Session> {
      return dynamoCreateSession(doc, tableName, now, input)
    },
    getSession(credId: string, sessionId: string): Promise<Session | undefined> {
      return dynamoGetSession(doc, tableName, credId, sessionId)
    },
    listSessions(credId: string): AsyncIterable<Session> {
      return dynamoListSessions(doc, tableName, credId)
    },
    patchSession(credId: string, patch: SessionPatch): Promise<Session> {
      return dynamoPatchSession(doc, tableName, credId, patch)
    },
    archiveSession(credId: string, sessionId: string): Promise<Session> {
      return dynamoArchiveSession(doc, tableName, now, credId, sessionId)
    },
    appendEntry(entry: NewSessionEntry): Promise<SessionEntry> {
      return dynamoAppendEntry(doc, tableName, ttlDays, now, entry)
    },
    getEntries(credId: string, sessionId: string): AsyncIterable<SessionEntry> {
      return dynamoGetEntries(doc, tableName, credId, sessionId)
    },
    patchEntry(credId: string, patch: EntryPatch): Promise<SessionEntry> {
      return dynamoPatchEntry(doc, tableName, credId, patch)
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
