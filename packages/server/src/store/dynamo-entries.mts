import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { redactCredentials } from '../core/redact.mjs'
import type { AppendedSessionEntry, Session, SessionEntry } from '../core/types.mjs'
import { entrySk, entriesPk, sessionSk, sessionsPk } from './dynamo-keys.mjs'
import { dynamoGetSession } from './dynamo-sessions.mjs'
import { resolveExistingSourceEvent, sourceEventPutItem } from './dynamo-source-events.mjs'
import { SessionStoreError } from './errors.mjs'
import { computeEntryExpiry, resolveEntryTtlDays, type RetentionPolicy } from './retention.mjs'
import { entryContentHash } from './source-event.mjs'
import type { GetEntriesOptions, NewSessionEntry } from './store.mjs'

const QUERY_PAGE_LIMIT = 100
const TIMESTAMP_RETRIES = 100

export function itemToEntry(item: Record<string, unknown>): SessionEntry {
  return {
    sessionId: item.sessionId as string,
    createdAt: item.createdAt as string,
    data: item.data as Record<string, unknown>,
    ...(typeof item.schemaId === 'string' ? { schemaId: item.schemaId } : {}),
    ...(typeof item.schemaVersion === 'number' ? { schemaVersion: item.schemaVersion } : {}),
    ...(typeof item.sourceEventId === 'string' ? { sourceEventId: item.sourceEventId } : {}),
    ...(typeof item.ttl === 'number' ? { expiresAt: new Date(item.ttl * 1000).toISOString() } : {}),
  }
}

async function requireSession(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
): Promise<Session> {
  const session = await dynamoGetSession(doc, tableName, credId, sessionId)
  if (!session) throw new SessionStoreError('session_not_found', `session not found: ${sessionId}`)
  return session
}

export async function dynamoAppendEntry(
  doc: DynamoDBDocumentClient,
  tableName: string,
  retention: RetentionPolicy,
  now: () => Date,
  input: NewSessionEntry,
): Promise<AppendedSessionEntry> {
  const { value: redactedData } = redactCredentials(input.data)
  const contentHash =
    input.sourceEventId !== undefined
      ? (input.sourceEventContentHash ??
        entryContentHash({
          data: redactedData,
          schemaId: input.schemaId,
          schemaVersion: input.schemaVersion,
        }))
      : undefined
  let effectiveTtlDays = retention.ttlDays
  let timestamp = now().getTime()
  if (retention.ttlOverrides.size > 0) {
    const session = await requireSession(doc, tableName, input.credId, input.sessionId)
    effectiveTtlDays = resolveEntryTtlDays(retention, session.data)
    timestamp = Math.max(
      timestamp,
      session.lastEntryAt === null ? 0 : Date.parse(session.lastEntryAt) + 1,
    )
  }
  for (let offset = 0; offset < TIMESTAMP_RETRIES; offset++) {
    const createdAt = new Date(timestamp).toISOString()
    const { ttl, expiresAt } = computeEntryExpiry(timestamp, effectiveTtlDays)
    const storedEntry = {
      sessionId: input.sessionId,
      createdAt,
      data: redactedData,
      ...(input.schemaId !== undefined ? { schemaId: input.schemaId } : {}),
      ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
      ...(input.sourceEventId !== undefined ? { sourceEventId: input.sourceEventId } : {}),
    }
    const transactItems: Array<Record<string, unknown>> = [
      {
        Update: {
          TableName: tableName,
          Key: { PK: sessionsPk(input.credId), SK: sessionSk(input.sessionId) },
          UpdateExpression: 'SET lastEntryAt = :createdAt',
          ConditionExpression:
            'attribute_exists(PK) AND (attribute_not_exists(lastEntryAt) OR lastEntryAt < :createdAt)',
          ExpressionAttributeValues: { ':createdAt': createdAt },
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: entriesPk(input.credId, input.sessionId),
            SK: entrySk(createdAt),
            entityType: 'entry',
            ...storedEntry,
            ttl,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ]
    if (input.sourceEventId !== undefined) {
      transactItems.push(
        sourceEventPutItem(
          tableName,
          { ...input, sourceEventId: input.sourceEventId },
          contentHash!,
          createdAt,
          ttl,
        ),
      )
    }
    try {
      await doc.send(new TransactWriteCommand({ TransactItems: transactItems }))
      return { ...storedEntry, expiresAt }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') throw error
      if (input.sourceEventId !== undefined) {
        const duplicate = await resolveExistingSourceEvent(
          doc,
          tableName,
          { ...input, sourceEventId: input.sourceEventId },
          contentHash!,
          itemToEntry,
        )
        if (duplicate) return duplicate
      }
      const session = await requireSession(doc, tableName, input.credId, input.sessionId)
      effectiveTtlDays = resolveEntryTtlDays(retention, session.data)
      timestamp = Math.max(
        timestamp + 1,
        session.lastEntryAt === null ? 0 : Date.parse(session.lastEntryAt) + 1,
      )
    }
  }
  throw new SessionStoreError(
    'timestamp_exhausted',
    `could not allocate a unique timestamp for session ${input.sessionId}`,
  )
}

export function dynamoResolveSourceEvent(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
  sourceEventId: string,
  contentHash: string,
): Promise<AppendedSessionEntry | undefined> {
  return resolveExistingSourceEvent(
    doc,
    tableName,
    { credId, sessionId, sourceEventId },
    contentHash,
    itemToEntry,
  )
}

export async function* dynamoGetEntries(
  doc: DynamoDBDocumentClient,
  tableName: string,
  credId: string,
  sessionId: string,
  options: GetEntriesOptions = {},
): AsyncGenerator<SessionEntry> {
  if (!options.sessionVerified) await requireSession(doc, tableName, credId, sessionId)
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': entriesPk(credId, sessionId),
          ':sk': 'ENTRY#',
        },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: QUERY_PAGE_LIMIT,
      }),
    )
    for (const item of page.Items ?? []) yield itemToEntry(item)
    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)
}
